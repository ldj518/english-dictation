import { buildPlan, mustTotalOf, tierOf, mergeCfg, DEFAULT_CFG, settleDaysLeft, gapDaysOf } from '../src/lib/plan'

/** p1 的真实处境（2026-10-29 从 D1 拉的实际数字） */
const P1 = {
  dueN: 127,        // due_day <= 今天
  weakN: 122,       // S = 1
  nailN: 40,        // lapses >= 4
  forgetRate: 0.48, // 累计正确率 52% → 遗忘率 48%
  perItemSec: 20,   // 当前还是兜底 20（手速回填未做）
  hasNew: true,     // unit04 还有 35 个没碰过
}

function show(tag: string, cfg: Partial<typeof DEFAULT_CFG>, gap: number, day: string) {
  const p = buildPlan({ dayKey: day, gapDays: gap, ...P1, cfg })
  const must = mustTotalOf(p)
  console.log(`\n【${tag}】${day} 断档 ${gap} 天`)
  console.log(`  档位 ${p.tier} · 目标 ${p.minMin}′ / 封顶 ${p.maxMin}′ · 目标题量 ${p.targetQ}`)
  console.log(`  到期词 ${p.dueN} · 新词 ${p.newN} · 预计 ${p.estMin}′ · 必做 ${must} 题`)
  console.log('  段：')
  for (const s of p.segs) console.log(`    ${s.k.padEnd(7)} ${s.label.padEnd(18)} ${String(s.q).padStart(3)} 题  ${s.min}′`)
  console.log(`  清账要走 ${settleDaysLeft(p.dueN, mergeCfg(cfg))} 天`)
}

console.log('=== 新配置（13/30 分钟，无爬坡，必做做完即完成）===')
show('工作日', {}, 4, '2026-10-29')
show('周六', {}, 1, '2026-10-31')
show('周日', {}, 1, '2026-11-01')

console.log('\n=== 对照：旧配置（30/45 分钟 + 爬坡第 1 周）===')
const OLD = { minMinWork: 30, minMinWeekend: 60, maxMinWork: 45, maxMinWeekend: 80, rampOn: true }
show('工作日-旧', OLD, 4, '2026-10-29')

console.log('\n=== 真实手速 13 秒（回填后会长这样）===')
show('工作日-13秒', {}, 4, '2026-10-29')
