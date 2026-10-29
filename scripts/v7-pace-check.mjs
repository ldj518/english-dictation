/**
 * 用 p1 的真实云端快照算今天这份计划：
 * 分别按「旧口径 20 秒」和「手速回填 13 秒」排一遍，看题量差多少。
 * 数据来自 /api/progress 的真实返回（_webdata/pr_v7.json）。
 */
import fs from 'node:fs'
import {
  buildPlan, mergeCfg, perItemSecOf, mustTotalOf, tierOf, gapDaysOf, rampWeekOf,
} from '../src/lib/plan.ts'
import { schoolUnitOf } from '../src/lib/school.ts'
import { dueWordList } from '../src/lib/memory.ts'
import { cnOf } from '../src/lib/qbank.ts'
import { bjDayKey } from '../src/lib/bj.ts'

// 用法：node scripts/v7-pace-check.mjs <progress接口的JSON文件>
// JSON 这样拿：curl -s "https://tingxie.5208090.xyz/api/progress?studentId=p1" > pr.json
const FILE = process.argv[2]
if (!FILE) { console.error('用法: node scripts/v7-pace-check.mjs <progress.json>'); process.exit(1) }
const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const p = j.data
p.lastActiveDay = j.lastActiveDay
if (j.recentPace) p.cloudPace = { ...j.recentPace, at: 0 }

const day = bjDayKey()
const cfg = mergeCfg(p.studyCfg)
const due = dueWordList(p, day, cnOf)
const su = schoolUnitOf(p)
const gap = gapDaysOf(p, day)

function run(perItemSec, label) {
  const plan = buildPlan({
    dayKey: day, gapDays: gap, dueN: due.length, weakN: 0, nailN: 0,
    forgetRate: 0.2, perItemSec, hasNew: su.left > 0, cfg, rampWeek: rampWeekOf(p.rampFrom || day, day),
    schoolLeft: su.left,
  })
  console.log(`--- ${label} ---`)
  console.log('  档位', plan.tier, '| 段数', plan.segs.filter(s => s.k !== 'wrap').length,
    '| 必做', mustTotalOf(plan), '| targetQ', (plan).targetQ, '| 估时', plan.estMin, '分')
  console.log('  分段:', plan.segs.map(s => `${s.k}${s.q}`).join(' '))
  return plan
}

console.log('真实数据：到期', due.length, '| 学过', su.learned, '| 学校单元', su.unit, '剩下', su.left, '| 断档', gap, '天')
console.log('本地日账:', Object.keys(p.dayLog || {}).length, '天 | 云端近7天:', JSON.stringify(j.recentPace))
console.log('perItemSec 实际取值 =', perItemSecOf(p, day), '秒/题')
console.log()
const a = run(20, '旧口径：写死 20 秒/题')
const b = run(perItemSecOf(p, day), `新口径：${perItemSecOf(p, day)} 秒/题（手速回填）`)
console.log()
console.log(`题量 ${mustTotalOf(a)} → ${mustTotalOf(b)}（+${mustTotalOf(b) - mustTotalOf(a)}）`,
  `| 估时 ${a.estMin} → ${b.estMin} 分`)
