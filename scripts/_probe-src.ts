/**
 * 临时诊断：用 p1 的真实处境跑「学校保底词 + 拼写分级」的新排课。
 * 用法：node scripts/_probe-plan.mjs
 */
import { buildPlan, mustTotalOf, mergeCfg, DEFAULT_CFG, settleDaysLeft, rotateUnitOf, rotateByUnit } from '../src/lib/plan'
import { buildQBank, unitOf } from '../src/lib/qbank'
import wordsJson from '../src/data/words.json'

const WORDS = wordsJson as unknown as { word: string; cn: string; unit: string }[]

/** p1 的真实处境（2026-10-29 从 D1 拉的实际数字） */
const P1 = {
  dueN: 127,
  weakN: 122,
  nailN: 40,
  forgetRate: 0.48,
  perItemSec: 13,   // 10-24/25 实测：60 题 13.4 秒
  hasNew: true,
  schoolLeft: 35,   // unit04：64 词只碰过 29 个
}

function show(tag: string, gap: number, day: string) {
  const p = buildPlan({ dayKey: day, gapDays: gap, ...P1, cfg: {} })
  const must = mustTotalOf(p)

  // 到期池：按 p1 的真实分布造（122 个 S=1，5 个已经稳住）
  const due = WORDS.slice(0, Math.min(P1.dueN, WORDS.length)).map((w, i) => ({
    word: w.word, cn: w.cn, S: i < 5 ? 8 : 1, unit: w.unit,
    // 前 40 个当钉子词，和 p1 的 lapses≥4 数量对齐
    state: { lapses: i < P1.nailN ? 5 : 0 },
  }))
  const dueUnits = Array.from(new Set(due.map(x => unitOf(x.word))))
  const rotated = rotateByUnit(due, rotateUnitOf(dueUnits, day), unitOf)
  const picked = rotated.slice(0, p.dueN).map(x => ({ word: x.word, cn: x.cn, S: x.S }))
  const newWords = WORDS.filter(w => w.unit === 'unit04').slice(29, 29 + p.newN)
    .map(w => ({ word: w.word, cn: w.cn }))

  const bank = buildQBank({
    plan: p, dueWords: picked, newWords, nailWords: [],
    unit: 'unit04', fileMap: new Map(), profileId: 'p1', enter: 1,
  })
  const byKind: Record<string, number> = {}
  for (const q of bank.qs) byKind[q.kind] = (byKind[q.kind] || 0) + 1

  console.log(`\n【${tag}】${day} 断档 ${gap} 天`)
  console.log(`  档位 ${p.tier} · 目标 ${p.minMin}′ / 封顶 ${p.maxMin}′`)
  console.log(`  到期词 ${p.dueN}（队列 ${P1.dueN}） · 学校词 ${p.schoolN} · 预计 ${p.estMin}′ · 必做 ${must} 题 · 总题 ${bank.qs.length}`)
  console.log('  段：')
  for (const s of p.segs) console.log(`    ${s.k.padEnd(7)} ${s.label.padEnd(16)} ${String(s.q).padStart(3)} 题  ${s.min}′`)
  console.log('  题型：', JSON.stringify(byKind))
  console.log(`  清账还要走 ${settleDaysLeft(p.dueN, mergeCfg({}))} 天`)
  return { p, bank }
}

console.log('=== p1 真实参数（13 秒/题，清账档）===')
show('工作日', 4, '2026-10-29')
show('周六', 1, '2026-10-31')
show('周日', 1, '2026-11-01')

console.log('\n=== 对照：昨天上线的版本（无学校词、无拼写分级）===')
const old = buildPlan({ dayKey: '2026-10-29', gapDays: 4, ...P1, schoolLeft: 0, cfg: {} })
console.log(`  段数 ${old.segs.length} · 必做 ${mustTotalOf(old)} 题 · 预计 ${old.estMin}′ · 学校词 0`)

export function run() { /* 探针自身在导入时已打印，这里留空给 runner */ }
