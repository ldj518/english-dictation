/**
 * 北京时间唯一入口（v4 P0）。
 *
 * 为什么单开一个文件：Cloudflare 边缘节点跑在 UTC，「今天」在 UTC 是
 * 08:00 才换日。孩子在 22:00-24:00 之间学习，后端 dayKey 算的是明天、
 * 前端 getHours() 算的是今天，两边差一天——打卡、到期、战报日期全错。
 *
 * 全站所有「今天是几号」只许从这里出，别处不许再出现
 * `new Date().getFullYear()` / `getMonth()` / `getDate()` / `getHours()`。
 *
 * 语义定死：**中国没有夏令时，固定 UTC+8**，不做时区库依赖。
 */

/** 北京时区偏移（毫秒）。中国全境 UTC+8，无夏令时历史问题（1991 年后取消）。 */
export const BJ_OFFSET_MS = 8 * 3600 * 1000

/** 当前北京时间的毫秒时间戳（= Date.now()，仅语义标注用） */
export function bjNow(): number {
  return Date.now()
}

const z2 = (n: number) => String(n).padStart(2, '0')

/**
 * 时间戳 → 北京日历日 'yyyy-mm-dd'。
 * 实现：先把时间戳平移到 UTC+8，再用 UTC 取值——这样不受运行环境本地时区影响，
 * 浏览器在 UTC、Cloudflare 在 UTC、孩子手机在 UTC+8，三者算出来完全一致。
 */
export function bjDayKey(ts: number | Date = Date.now()): string {
  const t = typeof ts === 'number' ? ts : ts.getTime()
  const d = new Date(t + BJ_OFFSET_MS)
  return `${d.getUTCFullYear()}-${z2(d.getUTCMonth() + 1)}-${z2(d.getUTCDate())}`
}

/** 北京此刻的时分（0-23） */
export function bjHour(ts: number = Date.now()): number {
  return new Date(ts + BJ_OFFSET_MS).getUTCHours()
}

/** 北京此刻的分钟 */
export function bjMinute(ts: number = Date.now()): number {
  return new Date(ts + BJ_OFFSET_MS).getUTCMinutes()
}

/** 'yyyy-mm-dd' → 该日北京 00:00 的毫秒时间戳（做日期运算用，不受本地时区影响） */
export function bjDayStart(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - BJ_OFFSET_MS
}

/** 'yyyy-mm-dd' → 0=周日 1=周一 … 6=周六 */
export function bjDow(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** 是否周末（周六/周日） */
export function bjIsWeekend(dayKey: string): boolean {
  const w = bjDow(dayKey)
  return w === 0 || w === 6
}

/** 日期加减天数，返回 'yyyy-mm-dd' */
export function bjAddDays(dayKey: string, n: number): string {
  return bjDayKey(bjDayStart(dayKey) + n * 86400000)
}

/** 两个日期相差天数（a - b，正数表示 a 更晚） */
export function bjDiffDays(a: string, b: string): number {
  return Math.round((bjDayStart(a) - bjDayStart(b)) / 86400000)
}

/** 本周一（北京时区）。「每周换顺序」的盐用它 */
export function bjWeekStart(dayKey: string = bjDayKey()): string {
  const w = bjDow(dayKey)          // 0=周日
  const back = (w + 6) % 7         // 周一=0
  return bjAddDays(dayKey, -back)
}

/** 当天是否工作日（周一至周五） */
export function bjIsWorkday(dayKey: string): boolean {
  const w = bjDow(dayKey)
  return w >= 1 && w <= 5
}

/** 人类可读的北京月日（家长看板/战报用） */
export function bjShort(dayKey: string): string {
  const [, m, d] = dayKey.split('-').map(Number)
  return `${m}/${d}`
}

/** 北京时间字符串 yyyy-mm-dd HH:MM */
export function bjStamp(ts: number = Date.now()): string {
  const d = new Date(ts + BJ_OFFSET_MS)
  return `${bjDayKey(ts)} ${z2(d.getUTCHours())}:${z2(d.getUTCMinutes())}`
}

/** 秒数 → m:ss */
export function fmtSec(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${z2(s % 60)}`
}

/** 秒数 → 中文「12 分 30 秒」 */
export function fmtSecCn(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m <= 0) return `${r} 秒`
  if (r === 0) return `${m} 分钟`
  return `${m} 分 ${r} 秒`
}
