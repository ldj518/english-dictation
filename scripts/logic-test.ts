/** 核心逻辑单测：判分、遗忘曲线、积分、数据完整性。
 *  这些是「一眼看不出对错」的地方，必须机器验证。
 */
import { judge, addWrong, advanceWrong, dueWrongWords, defaultProgress, REVIEW_STAGES } from '../src/lib/storage'
import { settle, levelOf } from '../src/lib/gamify'
import { ALL_TASKS as TASKS, WORDS, DAILY, UNITS, FINALS, UNIT_WORDS } from '../src/lib/data'

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

console.log('══ 核心逻辑单测 ══')
console.log(log.join('\n'))
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
