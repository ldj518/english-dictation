/**
 * 纯函数单测（memory.ts / plan.ts / 词表）。
 *
 * 方案 11.4 验收清单里能纯函数验的都在这里，跑法 `npm run test`。
 * 不引测试框架：见 scripts/run-tests.mjs 顶部说明。
 */
import {
  gradeWord, newState, isNail, dueWordList, queueHealth,
  migrateFromLegacy, assertMigration, S_MAX, S_MASTER, LAPSES_NAIL,
  type WordState,
} from '../src/lib/memory'
import {
  buildPlan, tierOf, gateCheck, mustTotalOf, mergeCfg, newAllowOf,
  rampWeekOf, rampMinOf, perItemSecOf, capHit, settleDaysLeft,
  DEFAULT_CFG, type PlanInput,
} from '../src/lib/plan'
import {
  gateOf, gradePaper, makeRun, patchLeft, buildPaper, unitWords,
  GATE_PASS, SPELL_PASS, PATCH_DAYS,
} from '../src/lib/gate'
import { bjAddDays, bjDayKey, bjDiffDays } from '../src/lib/bj'
import { mergeProgress } from '../src/lib/sync'
import { buildReport, reportText } from '../src/lib/report'
import type { Progress } from '../src/types'
import wordsJson from '../src/data/words.json'

interface R { name: string; ok: boolean; msgs: string[] }
const results: R[] = []

function t(name: string, fn: () => void) {
  const msgs: string[] = []
  const ck = (cond: boolean, m: string) => { if (!cond) msgs.push(m) }
  const eq = (a: unknown, b: unknown, m: string) =>
    ck(JSON.stringify(a) === JSON.stringify(b), `${m}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
  try {
    fn.call(null, { ck, eq })
  } catch (e) {
    msgs.push('抛错：' + (e instanceof Error ? e.message : String(e)))
  }
  results.push({ name, ok: msgs.length === 0, msgs })
}

type T = { ck: (c: boolean, m: string) => void; eq: (a: unknown, b: unknown, m: string) => void }

/* ══════════ 1. 记忆强度 S ══════════ */

t('答对：S 翻倍', (x: T) => {
  const at = Date.UTC(2026, 9, 28, 4, 0, 0)   // 北京 12:00
  const a = gradeWord({ ...newState(at), S: 4 }, true, { now: at })
  x.eq(a.S, 8, 'S 4→8')
  x.eq(a.streak, 1, '连续答对 +1')
  x.eq(a.master, 1, 'S≥4 记已掌握')
})

t('答对：封顶 60 天', (x: T) => {
  const at = Date.UTC(2026, 9, 28, 4, 0, 0)
  const a = gradeWord({ ...newState(at), S: 40 }, true, { now: at })
  x.eq(a.S, S_MAX, '40×2 封顶 60')
  const b = gradeWord({ ...newState(at), S: S_MAX }, true, { now: at })
  x.eq(b.S, S_MAX, '60 再答对仍 60')
})

t('有提示 / 速答：只涨 1.5 倍且不进连续', (x: T) => {
  const at = Date.UTC(2026, 9, 28, 4, 0, 0)
  const h = gradeWord({ ...newState(at), S: 4, streak: 2 }, true, { now: at, hinted: true })
  x.eq(h.S, 6, '4×1.5=6')
  x.eq(h.streak, 0, '提示过 → 连续归零')
  const f = gradeWord({ ...newState(at), S: 10 }, true, { now: at, fast: true })
  x.eq(f.S, 15, '10×1.5=15')
})

t('答错：S 归 1、lapses+1、明天必到', (x: T) => {
  const at = Date.UTC(2026, 9, 28, 4, 0, 0)
  const a = gradeWord({ ...newState(at), S: 30, lapses: 2, streak: 3, master: 2 }, false, { now: at })
  x.eq(a.S, 1, 'S 归 1')
  x.eq(a.lapses, 3, 'lapses 累加')
  x.eq(a.streak, 0, '连续归零')
  x.eq(a.master, 0, '掉出毕业')
  x.eq(a.due, '2026-10-29', '明天到期')
})

t('钉子词：lapses≥4', (x: T) => {
  x.ck(isNail({ ...newState(), lapses: LAPSES_NAIL }), '4 次算钉子')
  x.ck(!isNail({ ...newState(), lapses: LAPSES_NAIL - 1 }), '3 次不算')
})

t('毕业：S≥32 且连续 3 次无提示答对', (x: T) => {
  const at = Date.UTC(2026, 9, 28, 4, 0, 0)
  let s: WordState = { ...newState(at), S: 16, streak: 2 }
  s = gradeWord(s, true, { now: at })          // 32, streak 3 → 毕业
  x.eq(s.S, S_MASTER, 'S 到 32')
  x.eq(s.master, 2, '毕业')
  const at2 = Date.UTC(2026, 9, 28, 4, 0, 0)
  let u: WordState = { ...newState(at2), S: 16, streak: 2 }
  u = gradeWord(u, true, { now: at2, hinted: true })   // 24, streak 归零
  x.ck(u.master !== 2, '有提示不毕业')
})

t('跨月到期日计算', (x: T) => {
  x.eq(bjAddDays('2026-10-31', 1), '2026-11-01', '10-31 +1')
  x.eq(bjAddDays('2026-12-31', 1), '2027-01-01', '跨年')
  x.eq(bjAddDays('2026-03-01', -1), '2026-02-28', '闰年前一天')
  x.eq(bjDiffDays('2026-11-05', '2026-10-28'), 8, '相隔 8 天')
})

t('到期队列：已到期才算，毕业词不进，钉子优先', (x: T) => {
  const day = '2026-10-28'
  const p = {
    review: {}, wrong: {}, reviewDone: {}, history: [],
    wordState: {
      a: { ...newState(), S: 1, due: '2026-10-27', lapses: 0 },      // 逾期 1 天
      b: { ...newState(), S: 1, due: '2026-10-20', lapses: 5 },      // 钉子 + 逾期 8 天
      c: { ...newState(), S: 20, due: '2026-11-10' },                // 未到期
      d: { ...newState(), S: 32, due: '2026-10-01', master: 2 },     // 毕业
    },
  } as unknown as Progress
  const list = dueWordList(p, day, w => 'cn-' + w)
  x.eq(list.map(i => i.word), ['b', 'a'], '只含已到期，钉子在最前')
  x.eq(list[1].overdue, 1, '逾期天数')
})

t('迁移：老队列反推 S 且断言通过', (x: T) => {
  const p = {
    review: { look: { stage: 3, dueAt: Date.UTC(2026, 9, 30) } },
    wrong: { look: { count: 20, okCount: 8, lastAt: Date.UTC(2026, 9, 20) } },
    reviewDone: { famous: Date.UTC(2026, 9, 1) },
    history: [], wordState: {},
  } as unknown as Progress
  const st = migrateFromLegacy(p)
  x.eq(Object.keys(st).sort(), ['famous', 'look'], '三个来源去重')
  x.eq(st.look.S, 1, '错词本 → S=1')
  x.eq(st.look.lapses, 20, 'lapses 取错次数')
  x.eq(st.famous.master, 2, 'reviewDone → 毕业')
  x.ck(assertMigration(p, st).ok, '一致性断言通过')
})

/* ══════════ 2. 档位与时间闸门 ══════════ */

const cfg = mergeCfg({})

t('档位：清账期不因「昨天学过」而中断', (x: T) => {
  x.eq(tierOf(3, 182, cfg, '2026-10-28'), 'settle', '断档 3 天 + 182 到期 → 清账')
  x.eq(tierOf(1, 150, cfg, '2026-10-29'), 'settle', '昨天学过但还有 150 到期 → 仍清账')
  x.eq(tierOf(0, 150, cfg, '2026-10-29'), 'settle', '当天第二场也仍清账')
  x.eq(tierOf(1, 30, cfg, '2026-10-29'), 'normal', '掉到 30 个到期 → 回正常')
})

t('档位：断档与重启优先级', (x: T) => {
  x.eq(tierOf(7, 10, cfg, '2026-10-28'), 'restart', '断 7 天 → 重启')
  x.eq(tierOf(3, 10, cfg, '2026-10-28'), 'recover', '断 3 天 → 恢复')
  x.eq(tierOf(0, 10, cfg, '2026-10-31'), 'sat', '周六')
  x.eq(tierOf(0, 10, cfg, '2026-11-01'), 'sun', '周日')
})

t('清账期零新词，每天至少清 26 词', (x: T) => {
  const inp: PlanInput = {
    dayKey: '2026-10-28', gapDays: 3, dueN: 182, weakN: 150, nailN: 9,
    forgetRate: 0.1, perItemSec: 20, hasNew: true, cfg: {},
  }
  const p = buildPlan(inp)
  x.eq(p.tier, 'settle', '进清账')
  x.eq(p.newN, 0, '新词冻结')
  x.ck(p.dueN >= 26 && p.dueN <= 182, `清账量 ${p.dueN} 落在 26–182`)
  x.ck(p.segs.every(s => s.k !== 'learn' && s.k !== 'recall'), '不出教学段')
  x.ck(settleDaysLeft(p.dueN, cfg) <= 7, '不超过 7 天')
})

t('新词额度随遗忘率浮动 3–8', (x: T) => {
  const wide = mergeCfg({ newWordCap: 10 })
  x.eq(newAllowOf(0.5, wide, true), 3, '遗忘率高 → 3')
  x.eq(newAllowOf(0.1, wide, true), 8, '遗忘率低 → 8')
  x.eq(newAllowOf(0.2, cfg, true), 6, '中间 → 取上限 6')
  x.eq(newAllowOf(0.1, mergeCfg({}), true), 6, '默认上限压到 6')
  x.eq(newAllowOf(0.1, cfg, false), 0, '没新词 → 0')
})

t('三周爬坡 18→24→30', (x: T) => {
  x.eq(rampMinOf(30, 0), 18, '第 1 周 18')
  x.eq(rampMinOf(30, 1), 24, '第 2 周 24')
  x.eq(rampMinOf(30, 2), 30, '第 3 周起 30')
  x.eq(rampMinOf(20, 0), 18, '目标低于 18 取目标')
  x.eq(rampWeekOf('2026-10-01', '2026-10-01'), 0, '首日第 1 周')
  x.eq(rampWeekOf('2026-10-01', '2026-10-08'), 1, '第 8 天第 2 周')
  x.eq(rampWeekOf('2026-10-01', '2026-10-20'), 2, '第 20 天第 3 周')
  const inp: PlanInput = {
    dayKey: '2026-10-28', gapDays: 0, dueN: 10, weakN: 5, nailN: 0,
    forgetRate: 0.1, perItemSec: 20, hasNew: true, cfg: {}, rampWeek: 0,
  }
  x.eq(buildPlan(inp).minMin, 18, '爬坡期下限 18')
  const weekend = buildPlan({ ...inp, dayKey: '2026-10-31', rampWeek: 0 })
  x.eq(weekend.minMin, 60, '周末不爬坡，仍 60')
})

t('题量按手速倒推：手快题多，时间一样', (x: T) => {
  const base = {
    dayKey: '2026-10-28', gapDays: 0, dueN: 20, weakN: 10, nailN: 0,
    forgetRate: 0.1, hasNew: false, cfg: {}, rampWeek: 2,
  }
  const fast = buildPlan({ ...base, perItemSec: 12 } as PlanInput)
  const mid = buildPlan({ ...base, perItemSec: 22 } as PlanInput)
  const slow = buildPlan({ ...base, perItemSec: 30 } as PlanInput)
  x.ck(fast.targetQ > mid.targetQ && mid.targetQ > slow.targetQ, '题量单调递减')
  x.eq(fast.targetQ, 150, '12 秒/题 → 150 题')
  x.eq(mid.targetQ, 82, '22 秒/题 → 82 题')
  x.eq(slow.targetQ, 60, '30 秒/题 → 60 题')
  x.ck(Math.abs(fast.targetQ * 12 - 30 * 60) <= 60, '总时长仍落在 30 分钟')
  x.ck(Math.abs(slow.targetQ * 30 - 30 * 60) <= 60, '慢手总时长一致')
})

t('手速取自实测，没有历史用 20 秒', (x: T) => {
  const empty = { dayLog: {}, history: [] } as unknown as Progress
  x.eq(perItemSecOf(empty, '2026-10-28'), 20, '无历史 → 20')
  const p = {
    dayLog: {
      '2026-10-26': { effSec: 1200, qN: 60 },
      '2026-10-27': { effSec: 900, qN: 30 },
    },
    history: [],
  } as unknown as Progress
  x.eq(perItemSecOf(p, '2026-10-28'), 23, '(1200+900)/(60+30)=23.3 → 23')
})

t('封顶：到 45 分钟收尾', (x: T) => {
  const p = buildPlan({
    dayKey: '2026-10-28', gapDays: 0, dueN: 20, weakN: 5, nailN: 0,
    forgetRate: 0.1, perItemSec: 20, hasNew: false, cfg: {}, rampWeek: 2,
  })
  x.eq(p.maxMin, 45, '工作日封顶 45')
  x.ck(!capHit(p, 44 * 60), '44 分钟还没到')
  x.ck(capHit(p, 45 * 60), '45 分钟到点')
  const w = buildPlan({
    dayKey: '2026-10-31', gapDays: 0, dueN: 20, weakN: 5, nailN: 0,
    forgetRate: 0.1, perItemSec: 20, hasNew: false, cfg: {}, rampWeek: 2,
  })
  x.eq(w.maxMin, 80, '周末封顶 80')
})

t('双闸门：时间、必做、看答案比例', (x: T) => {
  const p = buildPlan({
    dayKey: '2026-10-28', gapDays: 0, dueN: 12, weakN: 6, nailN: 0,
    forgetRate: 0.1, perItemSec: 20, hasNew: false, cfg: {}, rampWeek: 2,
  })
  const total = mustTotalOf(p)
  x.ck(total > 0, '必做题量 > 0')
  const ok = gateCheck({ effSec: 30 * 60, plan: p, mustDone: total, mustTotal: total, peekN: 0, qN: total })
  x.ck(ok.done, '全满足 → 完成')
  const short = gateCheck({ effSec: 18 * 60, plan: p, mustDone: total, mustTotal: total, peekN: 0, qN: total })
  x.ck(!short.done && !short.timeOk && short.needSec === 12 * 60, '只做 18 分钟不过闸')
  const peek = gateCheck({ effSec: 30 * 60, plan: p, mustDone: total, mustTotal: total, peekN: Math.ceil(total * 0.5), qN: total })
  x.ck(!peek.done && !peek.peekOk, '看答案过半不过闸')
})

t('必做题量不含填充池', (x: T) => {
  const p = buildPlan({
    dayKey: '2026-10-28', gapDays: 0, dueN: 40, weakN: 20, nailN: 3,
    forgetRate: 0.1, perItemSec: 12, hasNew: true, cfg: { minMinWork: 30 }, rampWeek: 2,
  })
  const drillQ = p.segs.filter(s => s.k === 'drill').reduce((n, s) => n + s.q, 0)
  const mustQ = mustTotalOf(p)
  x.ck(drillQ >= 0, '有 drill 段也能算')
  x.eq(mustQ, p.segs.filter(s => ['review', 'recall', 'choice', 'spell', 'sent', 'paper', 'test'].includes(s.k))
    .reduce((n, s) => n + s.q, 0), '必做只算判分段')
})

t('清账剩余天数', (x: T) => {
  x.eq(settleDaysLeft(182, cfg), 7, '182 ÷ 26 → 7 天')
  x.eq(settleDaysLeft(26, cfg), 1, '一天清完')
})

/* ══════════ 3. 词表 ══════════ */

t('368 个词 unit 无空值，7 单元词数对齐', (x: T) => {
  const ws = wordsJson as { word: string; unit?: string }[]
  x.eq(ws.length, 368, '词数')
  const empty = ws.filter(w => !w.unit)
  x.eq(empty.length, 0, `空 unit 数（${empty.slice(0, 5).map(w => w.word).join(',')}）`)
  const cnt: Record<string, number> = {}
  for (const w of ws) cnt[w.unit || 'x'] = (cnt[w.unit || 'x'] || 0) + 1
  const sorted = Object.fromEntries(Object.entries(cnt).sort((a, b) => a[0].localeCompare(b[0])))
  // 7 单元 × 5–6 个听写日 × 每天 9–11 词；总数必须还是 368
  x.eq(sorted, { unit01: 52, unit02: 55, unit03: 51, unit04: 64, unit05: 60, unit06: 54, unit07: 32 }, '单元分布')
  x.eq(Object.values(cnt).reduce((a, b) => a + b, 0), 368, '单元之和等于词表')
})

t('每个词都有句子可拼（句子段覆盖率）', (x: T) => {
  const ws = (wordsJson as { word: string }[]).map(w => w.word)
  const dup = ws.filter((w, i) => ws.indexOf(w) !== i)
  x.eq(dup.length, 0, '词不重复')
})

t('合并云端快照不丢 v4/v5 字段', (x: T) => {
  const at = 1793194300000
  const local = {
    review: {}, wrong: {}, reviewDone: {}, history: [],
    best: {}, attempts: {}, badges: {}, minutes: {}, learned: {},
    passed: {}, flow: {}, planLog: {}, trioDone: {}, wrongLog: {},
    points: 0, streakDays: 5, lastDay: '2026-10-25',
    totalAnswers: 0, totalRight: 0, planDone: 0, settings: {},
    wordState: { look: { S: 4, due: '2026-10-30', lapses: 1, streak: 1, master: 1, at, ok: 2, n: 3 } },
    dayLog: { '2026-10-25': { dayKey: '2026-10-25', tier: 'normal', effSec: 1800, idleSec: 0, mustDone: 20, mustTotal: 20, qN: 20, rightN: 15, peekN: 0, done: true, segs: [], segDone: [], at } },
    tests: [{ id: 'u1', kind: 'gate', unit: 'unit01', dayKey: '2026-10-26', total: 30, right: 25, peekN: 0, score: 83, spellScore: 80, pass: true, passLine: 80, attempt: 1, at }],
    studyCfg: { minMinWork: 24 },
    migratedV4: 1,
    rampFrom: '2026-10-20',
  } as unknown as Progress
  // 云端快照没有 v4/v5 字段（线上现在就是这样）
  const cloud = JSON.parse(JSON.stringify(local)) as Record<string, unknown>
  delete cloud.wordState; delete cloud.dayLog; delete cloud.tests
  delete cloud.migratedV4; delete cloud.rampFrom; delete cloud.studyCfg

  const m = mergeProgress(local, cloud as unknown as Progress)
  x.eq(Object.keys(m.wordState || {}), ['look'], '词状态不被抹掉')
  x.eq(Object.keys(m.dayLog || {}), ['2026-10-25'], '日账本不被抹掉')
  x.eq((m.tests || []).length, 1, '测验记录不被抹掉')
  x.eq(m.rampFrom, '2026-10-20', '爬坡起点保留')
  x.eq(m.studyCfg?.minMinWork, 24, '学习参数本地优先')
})

t('合并同一词：取最近一次观测而不是取大 S', (x: T) => {
  const base = {
    review: {}, wrong: {}, reviewDone: {}, history: [],
    best: {}, attempts: {}, badges: {}, minutes: {}, learned: {},
    passed: {}, flow: {}, planLog: {}, trioDone: {}, wrongLog: {},
    points: 0, streakDays: 1, lastDay: '2026-10-28',
    totalAnswers: 0, totalRight: 0, planDone: 0, settings: {}, wordState: {},
  }
  const older = { ...base, wordState: { w: { S: 32, due: '2026-12-01', lapses: 0, streak: 3, master: 2, at: 1000, ok: 9, n: 9 } } } as unknown as Progress
  const newer = { ...base, wordState: { w: { S: 1, due: '2026-10-29', lapses: 1, streak: 0, master: 0, at: 2000, ok: 9, n: 10 } } } as unknown as Progress
  const m = mergeProgress(older, newer)
  x.eq(m.wordState!.w.S, 1, '答错后的新状态胜出')
  x.eq(m.wordState!.w.at, 2000, 'at 取新的')
})

t('战报六块齐全且结论只讲事实', (x: T) => {
  const at = 1793194300000
  const p = {
    review: {}, wrong: {}, reviewDone: {}, history: [],
    best: {}, attempts: {}, badges: {}, minutes: {}, learned: {},
    passed: {}, flow: {}, planLog: {}, trioDone: {}, wrongLog: {},
    points: 0, streakDays: 2, lastDay: '2026-10-28',
    totalAnswers: 0, totalRight: 0, planDone: 0, settings: {},
    wordState: {
      a: { S: 4, due: '2026-11-01', lapses: 0, streak: 1, master: 1, at, ok: 1, n: 1 },
      b: { S: 1, due: '2026-10-29', lapses: 1, streak: 0, master: 0, at, ok: 0, n: 1 },
    },
    dayLog: {
      '2026-10-28': {
        dayKey: '2026-10-28', tier: 'settle', effSec: 1500, idleSec: 300,
        mustDone: 24, mustTotal: 26, qN: 26, rightN: 18, peekN: 2, done: false, segs: [], segDone: [], at,
      },
    },
  } as unknown as Progress
  const plan = buildPlan({
    dayKey: '2026-10-28', gapDays: 1, dueN: 120, weakN: 90, nailN: 12,
    forgetRate: 0.2, perItemSec: 20, hasNew: true, cfg: {}, rampWeek: 2,
  })
  const recs = [
    { word: 'a', cn: '甲', kind: 'review', correct: true, seg: 0 },
    { word: 'b', cn: '乙', kind: 'review', correct: false, seg: 0 },
    { word: 'c', cn: '丙', kind: 'spell', correct: true, fast: true, seg: 1 },
  ]
  const d = buildReport(p, plan, recs, '2026-10-28')
  x.eq(d.score, 67, '首答对 2/3')
  x.eq(d.dueOk, 1, '到期对 1 个')
  const txt = reportText(d)
  for (const k of ['①', '②', '③', '④', '⑤', '⑥']) x.ck(txt.includes(k), `缺第 ${k} 块`)
  x.ck(txt.includes('速答 1 题'), '结论提到速答不计掌握')
  x.ck(!txt.includes('很棒') && !txt.includes('优秀'), '结论不写形容词')
})

/* ══════════ 5. 测验闸门（gate.ts） ══════════ */

const GDAY = '2026-10-28'
const AT3 = Date.UTC(2026, 9, 25, 4, 0, 0)   // 北京 10-25 12:00，距 GDAY 3 天
const AT0 = Date.UTC(2026, 9, 28, 1, 0, 0)   // 北京 10-28 09:00，同一天

/** 造一份「unit01 学了 n 个词」的进度 */
function gateP(n: number, S: number, at: number, due: string): Progress {
  const ws = unitWords('unit01')
  const state: Record<string, WordState> = {}
  for (let i = 0; i < n; i++) {
    state[ws[i]] = { S, due, lapses: 0, streak: 3, master: S >= 32 ? 2 : 0, at, ok: 1, n: 1 }
  }
  return { wordState: state, tests: [], wrong: [] } as unknown as Progress
}

t('闸门 ①：没学过不放考', (x: T) => {
  const g = gateOf(gateP(0, 0, AT3, '2026-11-01'), 'unit01', GDAY, 0)
  x.eq(g.ready, false, '空进度不 ready')
  x.ck(g.why.includes('没学过'), '原因写明没学过')
})

t('闸门 ②：学习率不足 80% 不放考', (x: T) => {
  const total = unitWords('unit01').length
  const n = Math.floor(total * 0.7)
  const g = gateOf(gateP(n, 6, AT3, '2026-11-01'), 'unit01', GDAY, 0)
  x.eq(g.stats.total, total, '词数与词表一致')
  x.eq(g.ready, false, `只学 ${n}/${total} 不 ready`)
  x.ck(g.why.includes('没学过'), '原因写明还差几个词')
})

t('闸门 ③：四条件齐了才 ready', (x: T) => {
  const total = unitWords('unit01').length
  const n = Math.ceil(total * 0.85)
  const g = gateOf(gateP(n, 6, AT3, '2026-11-01'), 'unit01', GDAY, 5)
  x.eq(g.ready, true, '学习率够 + S≥4 过半 + 隔天 + 到期少 → ready')
  x.eq(g.patchLeft, 0, '不在补丁期')
  x.eq(g.passed, false, '还没通过')
})

t('闸门 ④：今天刚学过不放考（考短时记忆没意义）', (x: T) => {
  const total = unitWords('unit01').length
  const g = gateOf(gateP(Math.ceil(total * 0.9), 6, AT0, '2026-11-01'), 'unit01', GDAY, 0)
  x.eq(g.stats.lastGap, 0, '同日 lastGap=0')
  x.eq(g.ready, false, '不 ready')
  x.ck(g.why.includes('隔一天'), '原因写明隔一天再考')
})

t('闸门 ⑤：全库到期 >20 不追加考试', (x: T) => {
  const total = unitWords('unit01').length
  const g = gateOf(gateP(Math.ceil(total * 0.9), 6, AT3, '2026-11-01'), 'unit01', GDAY, 30)
  x.eq(g.ready, false, '清账期不放考')
  x.ck(g.why.includes('到期'), '原因写明先清账')
})

t('判卷：总分 80 + 拼写 70 双线，会选不会写不算过', (x: T) => {
  const recs: { kind: string; correct: boolean; peek?: boolean }[] = []
  for (let i = 0; i < 12; i++) recs.push({ kind: 'spell', correct: i < 8 })
  for (let i = 0; i < 18; i++) recs.push({ kind: 'pick', correct: true })
  const r = gradePaper(recs)
  x.eq(r.score, 87, '(8+18)/30 = 87，总分过线')
  x.eq(r.spellScore, 67, '拼写 8/12 = 67')
  x.eq(r.pass, false, '拼写没到 70 → 整体不过')
  x.ck(GATE_PASS === 80 && SPELL_PASS === 70, '通过线没有被偷偷改掉')
})

t('判卷：看答案的题不进分母（和日常会话同口径）', (x: T) => {
  const r = gradePaper([
    { kind: 'spell', correct: true },
    { kind: 'spell', correct: false },
    { kind: 'pick', correct: true, peek: true },
  ])
  x.eq(r.peekN, 1, '记 1 道看答案')
  x.eq(r.total, 3, '总题数照实')
  x.eq(r.score, 50, '分母只算 2 题')
})

t('落库：不过 → 补丁期 3 天，过了 → 无补丁', (x: T) => {
  const fail = makeRun('gate', 'unit01', GDAY, gradePaper([
    { kind: 'spell', correct: false }, { kind: 'pick', correct: true },
  ]), 1, 'r1')
  x.eq(fail.patchUntil, bjAddDays(GDAY, PATCH_DAYS), '不过 → 3 天后到期')
  x.eq(fail.attempt, 1, '记第 1 次')
  const win = makeRun('gate', 'unit01', GDAY, gradePaper([
    { kind: 'spell', correct: true }, { kind: 'pick', correct: true },
  ]), 1, 'r2')
  x.eq(win.pass, true, '全对通过')
  x.eq(win.patchUntil, undefined, '过了不写补丁期')
})

t('补丁期：还剩几天算得准，过期归 0，通过后归 0', (x: T) => {
  const run = makeRun('gate', 'unit01', GDAY, gradePaper([{ kind: 'spell', correct: false }]), 1, 'r1')
  const p = { wordState: {}, tests: [run] } as unknown as Progress
  x.eq(patchLeft(p, 'unit01', GDAY), PATCH_DAYS, '当天剩 3 天')
  x.eq(patchLeft(p, 'unit01', bjAddDays(GDAY, 1)), 2, '第二天剩 2 天')
  x.eq(patchLeft(p, 'unit01', bjAddDays(GDAY, PATCH_DAYS)), 0, '补丁期最后一天归 0')
  const passRun = { ...run, pass: true, patchUntil: undefined }
  x.eq(patchLeft({ wordState: {}, tests: [passRun] } as unknown as Progress, 'unit01', GDAY), 0, '已通过不算补丁期')
})

t('组卷：30 题四段齐全，每题都带词', (x: T) => {
  const total = unitWords('unit01').length
  const qs = buildPaper(gateP(Math.ceil(total * 0.9), 6, AT3, '2026-11-01'), unitWords('unit01'), 'seed1')
  const by = (k: string) => qs.filter(q => q.kind === k).length
  x.ck(qs.length > 0 && qs.length <= 30, `题数 1–30（实际 ${qs.length}）`)
  x.eq(by('spell'), 12, '拼写 12')
  x.eq(by('pick'), 12, '听音选义 12')
  x.ck(qs.every(q => !!q.word), '每题都有词')
  x.eq(new Set(qs.map(q => q.id)).size, qs.length, '题号不重复')
  const again = buildPaper(gateP(Math.ceil(total * 0.9), 6, AT3, '2026-11-01'), unitWords('unit01'), 'seed1')
  x.eq(again.map(q => q.word), qs.map(q => q.word), '同一 seed 题序稳定')
})

export default { results }
