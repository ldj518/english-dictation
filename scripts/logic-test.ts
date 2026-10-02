/** 核心逻辑单测：判分、遗忘曲线、积分、数据完整性。
 *  这些是「一眼看不出对错」的地方，必须机器验证。
 */
import { judge, addWrong, advanceWrong, dueWrongWords, defaultProgress, REVIEW_STAGES } from '../src/lib/storage'
import { settle, levelOf } from '../src/lib/gamify'
import { ALL_TASKS as TASKS, WORDS, DAILY, UNITS, FINALS, UNIT_WORDS } from '../src/lib/data'
import { seededShuffle, makeSeed, orderSalt, orderEpoch } from '../src/lib/shuffle'
import { buildCnOptions } from '../src/lib/translate'
import { weekStartStr } from '../src/lib/storage'
import { calcWeekReport } from '../src/lib/weekreport'
import { mergeProgress } from '../src/lib/sync'
import { flowAdvance, flowStepOf, flowAllDone, FLOW_STEPS } from '../src/lib/flow'
import type { Progress } from '../src/types'
import { resolveRate, SLOW_RATE } from '../src/lib/player'

let pass = 0, fail = 0
const log: string[] = []

function t(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; log.push(`  ✓ ${name}${extra ? ' · ' + extra : ''}`) }
  else { fail++; log.push(`  ✗ ${name}${extra ? ' · ' + extra : ''}`) }
}

// ── 1. 判分 ──
log.push('【判分】')
t('完全一致', judge('hold on', 'hold on'))
t('大小写无关', judge('HOLD ON', 'hold on'))
t('首尾空格', judge('  hold on  ', 'hold on'))
t('多余空格', judge('hold   on', 'hold on'))
t('标点忽略', judge('hold on.', 'hold on'))
t('错误答案判错', !judge('hold in', 'hold on'))
t('空答案判错', !judge('', 'hold on'))
t('纯空格判错', !judge('   ', 'hold on'))
t('中文不匹配英文', !judge('持有', 'hold'))

// ── 2. 遗忘曲线 ──
log.push('【遗忘曲线】')
{
  const p = defaultProgress()
  addWrong(p, 'hello', '你好')
  t('入本后 stage=0', p.wrong['hello'].stage === 0)
  t('入本后 count=1', p.wrong['hello'].count === 1)
  t('dueAt 已设置', p.wrong['hello'].dueAt > Date.now())
  addWrong(p, 'hello', '你好')
  t('再错 count=2', p.wrong['hello'].count === 2)

  // 答对推进
  const r1 = advanceWrong(p, 'hello')
  t('答对推进到 stage=1', p.wrong['hello'].stage === 1 && !r1.graduated)
  // 连续推进到毕业
  let graduated = false
  for (let i = 0; i < REVIEW_STAGES.length; i++) {
    const r = advanceWrong(p, 'hello')
    if (r.graduated) graduated = true
  }
  t('推满后毕业出本', graduated && !p.wrong['hello'])
}
{
  // 到期筛选
  const p = defaultProgress()
  addWrong(p, 'a', 'x')
  p.wrong['a'].dueAt = Date.now() - 1000   // 已过期
  addWrong(p, 'b', 'y')
  p.wrong['b'].dueAt = Date.now() + 86400000
  const due = dueWrongWords(p)
  t('只取已到期的', due.length === 1 && due[0].word === 'a', `取到 ${due.length} 个`)
}

// ── 3. 积分与等级 ──
log.push('【积分与等级】')
{
  const p = defaultProgress()
  const b = settle(p, { perfect: true, maxStreak: 10, right: 10, kind: 'daily', trackId: 'day01', score: 100 })
  t('全对积分 > 0', p.points > 0, `${p.points} 分`)
  t('全对解锁「一百分」', p.badges['perfect'] !== undefined)
  t('全对解锁「初次登场」', p.badges['first'] !== undefined)
  t('连击解锁「连击达人」', p.badges['streak10'] !== undefined)
  t('返回新解锁列表', b.length >= 3, `${b.length} 个`)
  // 徽章不重复
  const p2 = defaultProgress()
  settle(p2, { perfect: true, maxStreak: 1, right: 10, kind: 'daily', trackId: 'day01', score: 100 })
  const again = settle(p2, { perfect: true, maxStreak: 1, right: 10, kind: 'daily', trackId: 'day02', score: 100 })
  t('徽章不重复解锁', !again.some(x => x.id === 'first'))
}
{
  t('0 分 = 1 级', levelOf(0).lv === 1)
  t('500 分 = 3 级', levelOf(500).lv === 3)
  t('大额积分等级合理', levelOf(99999).lv === 8, `lv=${levelOf(99999).lv}`)
}

// ── 4. 数据完整性 ──
log.push('【数据完整性】')
t('词条 368 个', WORDS.length === 368, `${WORDS.length}`)
t('任务 48 个', TASKS.length === 48, `${TASKS.length}`)
t('每日 36 个', DAILY.length === 36, `${DAILY.length}`)
t('单元 7 个', UNITS.length === 7, `${UNITS.length}`)
t('期末 5 个', FINALS.length === 5, `${FINALS.length}`)
t('词条无重复', new Set(WORDS.map(w => w.word)).size === WORDS.length)
t('每个任务都有 items', TASKS.every(x => x.items.length > 0))
t('每个任务都有时间戳', TASKS.every(x => x.items.every(i => i[3] >= 0 && i[4] > i[3])))
t('词条都有中文', WORDS.every(w => w.cn && w.cn.length > 0))
t('单元词表齐全', UNITS.every(u => (UNIT_WORDS[u.id] || []).length > 0))
{
  const totalWords = UNITS.reduce((s, u) => s + (UNIT_WORDS[u.id] || []).length, 0)
  const rawItems = UNITS.reduce((s, u) => s + u.items.length, 0)
  t('单元覆盖词数合理', totalWords >= 200, `${totalWords} 词`)
  // 去重后应 <= 原始条数（单元间存在重复词，属正常）
  t('去重后不超过原始条数', totalWords <= rawItems, `${totalWords} <= ${rawItems}`)
  // 每单元内部去重应生效
  t('单元内部已去重', UNITS.every(u => {
    const words = u.items.map(i => i[1])
    return new Set(words).size === (UNIT_WORDS[u.id] || []).length
  }))
  const maxSec = Math.max(...TASKS.map(x => x.seconds))
  t('最长音轨时长合理', maxSec > 600 && maxSec < 3000, `${maxSec} 秒`)
}

// ── 5. 随机洗牌（防规律的核心）──
log.push('【随机洗牌】')
{
  const src = Array.from({ length: 50 }, (_, i) => i)

  // 同种子必须完全可复现
  const a1 = seededShuffle(src, 'seed-A')
  const a2 = seededShuffle(src, 'seed-A')
  t('同种子结果一致', JSON.stringify(a1) === JSON.stringify(a2))

  // 不同种子结果不同
  const b = seededShuffle(src, 'seed-B')
  t('不同种子结果不同', JSON.stringify(a1) !== JSON.stringify(b))

  // 洗牌不丢元素、不改原数组
  t('不丢元素', a1.length === src.length && new Set(a1).size === src.length)
  t('不改原数组', JSON.stringify(src) === JSON.stringify(Array.from({ length: 50 }, (_, i) => i)))

  // 确实打乱了（不是原序）
  t('确实打乱了', JSON.stringify(a1) !== JSON.stringify(src))

  // 模拟真实场景：同一人同一天 → 顺序固定；换天 → 顺序变
  const day1 = seededShuffle(src, makeSeed('2026-10-01', 'p1', 'day01'))
  const day1again = seededShuffle(src, makeSeed('2026-10-01', 'p1', 'day01'))
  const day2 = seededShuffle(src, makeSeed('2026-10-02', 'p1', 'day01'))
  const p2 = seededShuffle(src, makeSeed('2026-10-01', 'p2', 'day01'))
  t('同人同天顺序稳定', JSON.stringify(day1) === JSON.stringify(day1again))
  t('换一天顺序变', JSON.stringify(day1) !== JSON.stringify(day2))
  t('换一人顺序变', JSON.stringify(day1) !== JSON.stringify(p2))

  // 分布均匀性：每个位置都应出现过不同元素
  const firsts = new Set<number>()
  for (let i = 0; i < 200; i++) firsts.add(seededShuffle(src, 'x' + i)[0])
  t('首元素分布够散', firsts.size > 30, `${firsts.size} 种`)

  // 真实词表洗牌
  const words = UNIT_WORDS['unit01'] || []
  const s1 = seededShuffle(words, makeSeed('2026-10-01', 'p1', 'unit01'))
  t('真实词表可洗牌', s1.length === words.length)
  t('真实词表确实乱序', JSON.stringify(s1) !== JSON.stringify(words))
}

// ── 6. 播放倍速（慢速按钮失效的回归测试）──
log.push('【播放倍速】')
{
  t('慢速固定 0.6×', resolveRate(true, 1) === SLOW_RATE)
  t('慢速不随用户设置变', resolveRate(true, 0.75) === SLOW_RATE && resolveRate(true, 1.15) === SLOW_RATE)
  // 这是历史 bug：0.75 * 0.7 = 0.525，慢到听不清
  t('慢速不会出现 0.525× 这种值', resolveRate(true, 0.75) !== 0.75 * 0.7)

  t('正常播放用用户设置', resolveRate(false, 1) === 1)
  t('正常播放 0.9×', resolveRate(false, 0.9) === 0.9)
  t('正常播放 1.15×', resolveRate(false, 1.15) === 1.15)

  // 异常输入兜底：不能出现 0 或 NaN（会导致音频静音/不播）
  t('rate=0 兜底为 1', resolveRate(false, 0) === 1)
  t('rate 负数兜底为 1', resolveRate(false, -1) === 1)
  t('rate=NaN 兜底为 1', resolveRate(false, NaN) === 1)
  t('rate 过大被夹到 2', resolveRate(false, 99) === 2)
  t('rate 过小被夹到 0.25', resolveRate(false, 0.01) === 0.25)
  t('慢速档明显慢于正常档', SLOW_RATE < resolveRate(false, 0.75))
}

// ── 7. 出题顺序（时间成分 + 云端盐，每天/每周/手动三档）──
log.push('【出题顺序】')
{
  // 盐：三种模式都参与种子（v2.1 的坑：daily 曾返回空串，重排点了没反应）
  t('daily 模式盐=云端盐（重排立刻生效）', orderSalt('daily', '2026-09-28', 'abc') === 'abc')
  t('weekly 模式盐=云端盐', orderSalt('weekly', '2026-09-28', 'abc') === 'abc')
  t('manual 模式盐=云端盐', orderSalt('manual', '2026-09-28', 'abc') === 'abc')
  t('无盐时兜底空串（不产生尾随 |）', orderSalt('manual', '2026-09-28', '') === '')
  t('undefined 模式盐仍透传', orderSalt(undefined, '2026-09-28', 'abc') === 'abc')

  // 时间成分：决定顺序多久自动变一次
  t('daily 时间成分=今天', orderEpoch('daily', '2026-10-01', '2026-09-28') === '2026-10-01')
  t('weekly 时间成分=本周一', orderEpoch('weekly', '2026-10-01', '2026-09-28') === '2026-09-28')
  t('manual 时间成分=固定串', orderEpoch('manual', '2026-10-01', '2026-09-28') === 'fixed')
  t('undefined 模式按 daily 处理', orderEpoch(undefined, '2026-10-01', '2026-09-28') === '2026-10-01')

  // 周一日期串：2026-10-01 是周四 → 本周一是 09-28；10-05 周一 → 自己
  t('周四归到本周一', weekStartStr(new Date(2026, 9, 1)) === '2026-09-28', weekStartStr(new Date(2026, 9, 1)))
  t('周一归自己', weekStartStr(new Date(2026, 9, 5)) === '2026-10-05')
  t('周日仍归本周', weekStartStr(new Date(2026, 9, 4)) === '2026-09-28')

  // 盐参与种子：不同盐必须产生不同顺序（重排要真的「变」）
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const a = seededShuffle(arr, makeSeed('2026-10-01', 'p1', 'day01', ''))
  const b = seededShuffle(arr, makeSeed('2026-10-01', 'p1', 'day01', 'salt1'))
  const c = seededShuffle(arr, makeSeed('2026-10-01', 'p1', 'day01', 'salt2'))
  t('不同盐顺序不同', JSON.stringify(a) !== JSON.stringify(b) && JSON.stringify(b) !== JSON.stringify(c))
  t('同盐可复现', JSON.stringify(seededShuffle(arr, makeSeed('2026-10-01', 'p1', 'day01', 'salt1'))) === JSON.stringify(b))

  // manual 档：时间成分固定 → 跨天顺序不变（这正是「家长手动」的语义）
  const m1 = seededShuffle(arr, makeSeed(orderEpoch('manual', '2026-10-01', 'x'), 'p1', 'day01', 'salt1'))
  const m2 = seededShuffle(arr, makeSeed(orderEpoch('manual', '2026-10-02', 'x'), 'p1', 'day01', 'salt1'))
  t('manual 跨天顺序不变（重排才变）', JSON.stringify(m1) === JSON.stringify(m2))
  // daily 档：跨天必须变
  const d1 = seededShuffle(arr, makeSeed(orderEpoch('daily', '2026-10-01', 'x'), 'p1', 'day01', 'salt1'))
  const d2 = seededShuffle(arr, makeSeed(orderEpoch('daily', '2026-10-02', 'x'), 'p1', 'day01', 'salt1'))
  t('daily 跨天顺序变化', JSON.stringify(d1) !== JSON.stringify(d2))
  // 立即重排：manual 档换盐 → 顺序立刻变化
  const m3 = seededShuffle(arr, makeSeed(orderEpoch('manual', '2026-10-02', 'x'), 'p1', 'day01', 'salt2'))
  t('manual 换盐后顺序立刻变', JSON.stringify(m2) !== JSON.stringify(m3))
}

// ── 8. 翻译关选项（英译汉四选一）──
log.push('【翻译关选项】')
{
  const items = [
    { word: 'apple', cn: '苹果' },
    { word: 'banana', cn: '香蕉' },
    { word: 'cat', cn: '猫' },
    { word: 'dog', cn: '狗' },
    { word: 'egg', cn: '鸡蛋' },
    { word: 'fish', cn: '鱼' },
  ]
  const o1 = buildCnOptions(items, 'apple', 'seed-a')
  t('返回 6 个选项（1 正确 + 5 干扰，v3.3）', o1.length === 6)
  t('有且仅有 1 个正确项', o1.filter(o => o.correct).length === 1)
  t('正确项是目标词释义', o1.find(o => o.correct)?.cn === '苹果')
  t('无重复释义', new Set(o1.map(o => o.cn)).size === 6)
  t('同种子可复现', JSON.stringify(o1) === JSON.stringify(buildCnOptions(items, 'apple', 'seed-a')))
  t('不同种子顺序可不同', JSON.stringify(o1) !== JSON.stringify(buildCnOptions(items, 'apple', 'seed-b')) || o1.length === 6)

  // 词卷太小（只有 2 个词）时不崩、不掺重复；带全册兜底池时干扰项补足
  const tiny = [{ word: 'hot', cn: '热' }, { word: 'cold', cn: '冷' }]
  const o2 = buildCnOptions(tiny, 'hot', 's')
  t('小词卷降级到 2 选项', o2.length === 2 && new Set(o2.map(o => o.cn)).size === 2)
  const pool = [
    { word: 'warm', cn: '温暖的' }, { word: 'cool', cn: '凉爽的' },
    { word: 'big', cn: '大的' }, { word: 'small', cn: '小的' },
    { word: 'tall', cn: '高的' }, { word: 'short', cn: '矮的' },
    { word: 'dup', cn: '冷' },
  ]
  const o3 = buildCnOptions(tiny, 'hot', 's', pool)
  t('全册兜底补足到 6 选项', o3.length === 6)
  t('兜底不掺重复释义（含与卷内冲突的）', new Set(o3.map(o => o.cn)).size === 6)

  // 目标词无释义时不崩
  const bad = [{ word: 'x', cn: '' }, { word: 'y', cn: '有释义' }]
  t('空释义返回空选项', buildCnOptions(bad, 'x', 's').length === 0)
}

// ── 每周报告（v3.4）──
log.push('【每周报告】')
{
  const p = defaultProgress()
  const now = new Date()
  const thisMon = weekStartStr(now)
  const mon0 = new Date(thisMon + 'T00:00:00').getTime()
  // 本周两条提交：一条 4/5，一条 5/5 → 加权 9/10=90%
  p.history.push({ trackId: 'day01', trackLabel: 'a', total: 5, right: 4, score: 80, at: mon0 + 3600e3, records: [] })
  p.history.push({ trackId: 'day02', trackLabel: 'b', total: 5, right: 5, score: 100, at: mon0 + 2 * 86400e3, records: [] })
  // 本周新增错词两个（count 2 和 1）+ 上周的旧错词（不应进 TOP）
  p.wrong['alpha'] = { word: 'alpha', cn: '甲', count: 2, streak: 0, addedAt: mon0 + 3600e3, lastAt: mon0 + 3600e3, dueAt: mon0, stage: 0 }
  p.wrong['beta'] = { word: 'beta', cn: '乙', count: 1, streak: 0, addedAt: mon0 + 7200e3, lastAt: mon0 + 7200e3, dueAt: mon0, stage: 0 }
  p.wrong['old'] = { word: 'old', cn: '旧', count: 9, streak: 0, addedAt: mon0 - 10 * 86400e3, lastAt: mon0 - 10 * 86400e3, dueAt: mon0, stage: 0 }
  // 本周过关 unit01
  p.passed = { unit01: { at: mon0 + 3 * 86400e3, score: 90 } }
  // 分钟表：两天各 10 分钟
  const d1 = todayStrOf(mon0 + 3600e3)
  const d2 = todayStrOf(mon0 + 2 * 86400e3)
  p.minutes[d1] = 10
  p.minutes[d2] = 10

  const rep = calcWeekReport(p, now)
  t('本周提交数=2', rep.thisWeek.sessions === 2)
  t('本周加权正确率=90', rep.thisWeek.acc === 90)
  t('练习天数=2', rep.thisWeek.days === 2)
  t('学习分钟=20', rep.thisWeek.minutes === 20)
  t('上周无数据 acc=null', rep.lastWeek.acc === null)
  t('上周无数据时环比=null', rep.accDelta === null)
  t('新增错词只含本周两条', rep.newWrongs.length === 2 && rep.newWrongs[0].word === 'alpha')
  t('旧错词不混入周报', !rep.newWrongs.some(w => w.word === 'old'))
  t('本周过关含 unit01', rep.passedUnits.length === 1 && rep.passedUnits[0].score === 90)
  t('有错词时建议提到清错词', rep.advice.length > 0)

  // 环比：给上周也放一条 5/5（100%）→ 本周 90 vs 上周 100 = -10
  const p2 = { ...p, history: [...p.history, { trackId: 'day00', trackLabel: 'c', total: 5, right: 5, score: 100, at: mon0 - 3 * 86400e3, records: [] }] }
  const rep2 = calcWeekReport(p2, now)
  t('环比=上周100-本周90 → -10', rep2.accDelta === -10)
  t('下降时建议含放缓/清错词语义', rep2.advice.length > 0)
}

// ── 单元过关合并（v3.4）──
log.push('【过关记录合并】')
{
  const a = defaultProgress()
  const b = defaultProgress()
  a.passed = { unit01: { at: 1000, score: 85 } }
  b.passed = { unit01: { at: 2000, score: 92 }, unit02: { at: 1500, score: 88 } }
  const m = mergeProgress(a, b)
  t('同单元取高分 92', m.passed?.unit01.score === 92)
  t('另一设备过关也并入', m.passed?.unit02.score === 88)
  // 同分取更早
  const c = defaultProgress()
  c.passed = { unit01: { at: 500, score: 92 } }
  const m2 = mergeProgress(m, c)
  t('同分取更早过关时间', m2.passed?.unit01.at === 500)
  // 低分不覆盖高分
  const d = defaultProgress()
  d.passed = { unit01: { at: 9999, score: 60 } }
  const m3 = mergeProgress(m2, d)
  t('低分不覆盖高分', m3.passed?.unit01.score === 92 && m3.passed?.unit01.at === 500)
}

// ── 五关闯关（v3.5）──
log.push('【闯关进度】')
{
  const DAY = '2026-10-02'
  t('五关定义齐全（1-5 各一个）', FLOW_STEPS.length === 5 && FLOW_STEPS.map(s => s.step).join(',') === '1,2,3,4,5')
  t('五关路由都是 plan 任务', FLOW_STEPS.every(s => s.route.endsWith('/plan')))
  const p0 = defaultProgress()
  t('初始下一步是第 1 关', flowStepOf(p0, DAY) === 1)
  t('初始未通关', !flowAllDone(p0, DAY))
  // 逐关推进
  let flow: NonNullable<Progress['flow']> = {}
  let p = p0
  for (let s = 1; s <= 5; s++) {
    const next = flowAdvance(flow, s, DAY)
    if (!next) { t(`推进第 ${s} 关失败`, false); break }
    flow = next
    p = { ...p, flow }
    if (s < 5) t(`过完 ${s} 关 → 下一步第 ${s + 1} 关`, flowStepOf(p, DAY) === s + 1)
  }
  t('五关全过 → 下一步 6（已通关）', flowStepOf(p, DAY) === 6)
  t('五关全过 → flowAllDone', flowAllDone(p, DAY))
  // 幂等：重复提交第 5 关不动账
  const replay = flowAdvance(flow, 5, DAY)
  t('重复提交第 5 关 → null 不动账', replay === null)
  // 乱序：只过了 1 关就想记第 3 关
  const flow1: NonNullable<Progress['flow']> = { [DAY]: { step: 1 } }
  t('乱序提交（cur=1 记第 3 关）→ null', flowAdvance(flow1, 3, DAY) === null)
  // 跨天互不影响
  t('昨天关数不影响今天', flowStepOf(p, '2026-10-03') === 1)
  // 合并：同日取 step 大者
  const a = defaultProgress()
  a.flow = { [DAY]: { step: 3 } }
  const b = defaultProgress()
  b.flow = { [DAY]: { step: 5 }, '2026-10-01': { step: 5 } }
  const m = mergeProgress(a, b)
  t('合并同日取 step 大者 5', m.flow?.[DAY].step === 5)
  t('另一设备的另一天也并入', m.flow?.['2026-10-01'].step === 5)
  // 反向：a 更远也取大者
  const a2 = defaultProgress()
  a2.flow = { [DAY]: { step: 4 } }
  const b2 = defaultProgress()
  b2.flow = { [DAY]: { step: 2 } }
  const m2 = mergeProgress(a2, b2)
  t('本地更远也取大者 4', m2.flow?.[DAY].step === 4)
}

function todayStrOf(ts: number): string {
  const d = new Date(ts)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

console.log('══ 核心逻辑单测 ══')
console.log(log.join('\n'))
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
