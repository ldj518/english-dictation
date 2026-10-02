/**
 * 每周家长报告（v3.4）：纯逻辑，可在 Node 里单测。
 *
 * 只和自己比：本周 vs 上周的练习天数、正确率、学习分钟，
 * 加本周新增错词 TOP5 和下周建议。绝不出现名次/和别人比。
 *
 * 周界与全局约定一致：周一起算（weekStartStr），北京时间语义由本地时钟保证。
 */
import type { Progress } from '../types'
import { todayStr, weekStartStr } from './storage'
import { WORD_MAP } from './data'

const DAY = 86400000

export interface WeekStats {
  /** 练习天数（当天有提交记录即算，去重） */
  days: number
  /** 提交卷数 */
  sessions: number
  /** 总答题数 */
  total: number
  /** 答对数 */
  right: number
  /** 正确率（百分数整数）；无提交时 null，避免「0%」误导 */
  acc: number | null
  /** 学习分钟（history 秒数累计折算） */
  minutes: number
}

export interface WeekReport {
  thisWeek: WeekStats
  lastWeek: WeekStats
  /** 正确率环比（百分点，正=进步）；任一队无数据则 null */
  accDelta: number | null
  /** 本周新增错词（按累计错误次数降序，最多 5 个） */
  newWrongs: { word: string; cn: string; count: number }[]
  /** 下周建议文案（已按数据组织好，直接展示） */
  advice: string
  /** 本周过关的单元 */
  passedUnits: { unit: string; score: number }[]
}

const emptyWeek = (): WeekStats => ({ days: 0, sessions: 0, total: 0, right: 0, acc: null, minutes: 0 })

/** 统计某一周（weekStart 为那周一的 yyyy-mm-dd）的提交记录 */
function statsForWeek(history: Progress['history'], weekStart: string, minuteMap: Record<string, number>): WeekStats {
  const start = new Date(weekStart + 'T00:00:00').getTime()
  const end = start + 7 * DAY
  const s = emptyWeek()
  const daySet = new Set<string>()
  for (const h of history) {
    if (h.at < start || h.at >= end) continue
    s.sessions += 1
    s.total += h.total
    s.right += h.right
    daySet.add(todayStr(new Date(h.at)))
  }
  // 分钟按每日分钟表累计（分钟表本身就是按日记录的）
  for (const d of daySet) s.minutes += minuteMap[d] || 0
  s.days = daySet.size
  s.acc = s.total > 0 ? Math.round((s.right / s.total) * 100) : null
  return s
}

export function calcWeekReport(progress: Progress, now = new Date()): WeekReport {
  const thisStart = weekStartStr(now)
  const lastStart = weekStartStr(new Date(now.getTime() - 7 * DAY))
  const thisWeek = statsForWeek(progress.history, thisStart, progress.minutes)
  const lastWeek = statsForWeek(progress.history, lastStart, progress.minutes)

  const accDelta = thisWeek.acc !== null && lastWeek.acc !== null
    ? thisWeek.acc - lastWeek.acc
    : null

  // 本周新增错词：addedAt 落在本周的
  const wStart = new Date(thisStart + 'T00:00:00').getTime()
  const wEnd = wStart + 7 * DAY
  const newWrongs = Object.values(progress.wrong)
    .filter(w => w.addedAt >= wStart && w.addedAt < wEnd)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(w => ({ word: w.word, cn: w.cn, count: w.count }))

  // 本周过关的单元
  const passedUnits = Object.entries(progress.passed || {})
    .filter(([, v]) => v.at >= wStart && v.at < wEnd)
    .map(([unit, v]) => ({ unit, score: v.score }))
    .sort((a, b) => a.unit.localeCompare(b.unit))

  return { thisWeek, lastWeek, accDelta, newWrongs, passedUnits, advice: buildAdvice(progress, thisWeek, lastWeek, newWrongs, accDelta) }
}

/** 下周建议：数据驱动的一句话，直白不鸡汤 */
function buildAdvice(
  progress: Progress,
  thisWeek: WeekStats,
  lastWeek: WeekStats,
  newWrongs: { word: string; cn: string; count: number }[],
  accDelta: number | null,
): string {
  // 一次都没练：建议直给
  if (thisWeek.sessions === 0) {
    return lastWeek.sessions > 0
      ? '这周一次都没练，上周的劲别断。明天从今天的计划卷开始，先做一张找找感觉。'
      : '这周还没开始。别贪多，明天先做一张每日听写卷（十几分钟），先动起来。'
  }
  // 没有错词：顺着推新内容
  if (newWrongs.length === 0) {
    return '这周错词很少，基础在变扎实。下周按计划推新词就行，稳住节奏。'
  }
  // 错词集中：点名单元
  const units = unitOfWrongs(newWrongs)
  if (units.length && units[0].count >= 3 && units[0].unit) {
    const passedOk = progress.passed?.[units[0].unit]
    return passedOk
      ? `错词集中在 ${units[0].unit.replace('unit', 'Unit ')}（${units[0].count} 个），虽然过关过，但忘了的要用复习队列拉回来，下周优先清这份错词。`
      : `错词集中在 ${units[0].unit.replace('unit', 'Unit ')}（${units[0].count} 个），下周优先清这份错词，清完去考一次过关测试。`
  }
  // 正确率环比给方向
  if (accDelta !== null && accDelta <= -10) {
    return '正确率比上周掉了不少，多半是新词变难了。下周放慢一点，每天卷子做完把错词跟着复习清掉。'
  }
  return '错词不多，保持现在的节奏。下周记得做错词复习，别让它们堆过周末。'
}

/** 把错词映射回单元，按出现次数排序 */
function unitOfWrongs(wrongs: { word: string }[]): { unit: string; count: number }[] {
  const counter: Record<string, number> = {}
  for (const w of wrongs) {
    const u = WORD_MAP[w.word]?.unit
    if (!u) continue
    counter[u] = (counter[u] || 0) + 1
  }
  return Object.entries(counter)
    .map(([unit, count]) => ({ unit, count }))
    .sort((a, b) => b.count - a.count)
}
