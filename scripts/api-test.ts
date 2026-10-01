/** 后端工具函数测试：dayKey / weekKey / monthKey 的时区正确性。
 *  这些直接影响「按天/周/月统计」是否算对，必须机器验证。
 */
import { dayKey, weekKey, monthKey, uid } from '../functions/api/_utils'

let pass = 0, fail = 0
const log: string[] = []
function t(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; log.push(`  ✓ ${name}${extra ? ' · ' + extra : ''}`) }
  else { fail++; log.push(`  ✗ ${name}${extra ? ' · ' + extra : ''}`) }
}

log.push('【日期键（北京时间 UTC+8）】')

// 2026-10-01 00:30 北京时间 = 2026-09-30 16:30 UTC
// 必须归到 10-01，不能是 09-30
const t1 = Date.UTC(2026, 8, 30, 16, 30)   // UTC 2026-09-30 16:30
t('北京凌晨算当天', dayKey(t1) === '2026-10-01', dayKey(t1))

// 2026-10-01 23:30 北京时间 = 2026-10-01 15:30 UTC
const t2 = Date.UTC(2026, 9, 1, 15, 30)
t('北京深夜算当天', dayKey(t2) === '2026-10-01', dayKey(t2))

// 跨月边界：2026-11-01 00:10 北京 = 2026-10-31 16:10 UTC
const t3 = Date.UTC(2026, 9, 31, 16, 10)
t('跨月边界正确', dayKey(t3) === '2026-11-01', dayKey(t3))

// 跨年边界：2027-01-01 00:10 北京 = 2026-12-31 16:10 UTC
const t4 = Date.UTC(2026, 11, 31, 16, 10)
t('跨年边界正确', dayKey(t4) === '2027-01-01', dayKey(t4))

log.push('【周键（周一起算）】')

// 2026-10-01 是周四 → 本周一是 2026-09-28
t('周四归到本周一', weekKey(t2) === '2026-09-28', weekKey(t2))

// 2026-09-28 是周一 → 归自己
t('周一归自己', weekKey(Date.UTC(2026, 8, 28, 5)) === '2026-09-28', weekKey(Date.UTC(2026, 8, 28, 5)))

// 2026-10-04 是周日 → 本周一仍是 09-28
t('周日归一(不是下周)', weekKey(Date.UTC(2026, 9, 4, 4)) === '2026-09-28', weekKey(Date.UTC(2026, 9, 4, 4)))

// 2026-10-05 是周一 → 新的一周
t('下周一开启新周', weekKey(Date.UTC(2026, 9, 5, 4)) === '2026-10-05', weekKey(Date.UTC(2026, 9, 5, 4)))

log.push('【月键】')
t('10月', monthKey(t2) === '2026-10', monthKey(t2))
t('跨月边界归11月', monthKey(t3) === '2026-11', monthKey(t3))

log.push('【uid 唯一性】')
{
  const set = new Set<string>()
  for (let i = 0; i < 2000; i++) set.add(uid('s_'))
  t('uid 2000 次无碰撞', set.size === 2000, `${set.size}`)
  t('uid 带前缀', Array.from(set)[0].startsWith('s_'))
}

console.log('══ 后端工具单测 ══')
console.log(log.join('\n'))
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
