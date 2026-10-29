/**
 * 课本进度推断：学校正在讲第几单元。
 *
 * 为什么不问家长：家长报「讲到第四单元」只有一次准，两周后教材往前走，
 * 没人会天天回来改设置。而答题记录里天然有答案——从 unit01 往上排，
 * 第一个「学了但没学完」的单元就是课堂在讲的。
 *
 * 这个数直接决定两件事：
 *  ① 每天保底给几个新词（清账期也给，见 plan.schoolNewPerDay）
 *  ② 句子关从哪个单元的句库取句
 *
 * 单独放一个文件是为了让 /today 和首页 TodayCard 用同一个口径——
 * 两边各算一次的结果是首页说「6 段」、进去变「8 段」，家长会当成 bug 报上来。
 */

import { WORDS } from './data'
import type { Progress } from '../types'

export interface SchoolInfo {
  /** 学校正在讲的单元，如 unit04 */
  unit: string
  /** 该单元还没学过的词数 */
  left: number
  /** 该单元总词数 */
  total: number
  /** 已经学过的词数 */
  learned: number
}

export function schoolUnitOf(p: Progress): SchoolInfo {
  const state = p.wordState || {}
  const total: Record<string, number> = {}
  const learned: Record<string, number> = {}
  for (const w of WORDS) {
    const u = w.unit || 'extra'
    if (u === 'extra') continue
    total[u] = (total[u] || 0) + 1
    if (state[w.word]) learned[u] = (learned[u] || 0) + 1
  }
  const ids = Object.keys(total).sort()
  // 第一个「有进度但没满」的单元；全是新账号 → 第一个单元；全学完 → 最后一个
  const unit =
    ids.find(u => (learned[u] || 0) > 0 && (learned[u] || 0) < total[u])
    || ids.find(u => (learned[u] || 0) === 0)
    || ids[ids.length - 1] || 'unit04'
  return {
    unit,
    left: Math.max(0, (total[unit] || 0) - (learned[unit] || 0)),
    total: total[unit] || 0,
    learned: learned[unit] || 0,
  }
}
