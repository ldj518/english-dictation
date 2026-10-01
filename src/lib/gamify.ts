import type { Progress, Badge } from '../types'
import { todayStr } from './storage'

/** 全部徽章定义 */
export const BADGES: Badge[] = [
  { id: 'first', name: '初次登场', desc: '完成第一次听写', icon: '🎬' },
  { id: 'd10', name: '十日之约', desc: '连续打卡 10 天', icon: '📅' },
  { id: 'd30', name: '月度铁人', desc: '连续打卡 30 天', icon: '🏅' },
  { id: 'perfect', name: '一百分', desc: '某次听写全对', icon: '💯' },
  { id: 'perfect5', name: '稳如磐石', desc: '累计 5 次全对', icon: '🎯' },
  { id: 'w100', name: '词汇百人斩', desc: '累计答对 100 词', icon: '⚔️' },
  { id: 'w368', name: '全册通关', desc: '累计答对 368 词', icon: '👑' },
  { id: 'unit1', name: '单元征服者', desc: '完成一个单元测试', icon: '🚩' },
  { id: 'unit7', name: '七单元制霸', desc: '完成全部 7 个单元测试', icon: '🏆' },
  { id: 'clean', name: '错词清零', desc: '把错词本清空', icon: '🧹' },
  { id: 'streak10', name: '连击达人', desc: '单次听写连续答对 10 词', icon: '🔥' },
  { id: 'final', name: '期末勇士', desc: '完成一次期末模考', icon: '🗡️' },
  { id: 'allfinal', name: '期末考试王', desc: '完成全部 5 次期末模考', icon: '🌟' },
  { id: 'p1000', name: '千分学者', desc: '累计积分达到 1000', icon: '💎' },
]

export interface AwardCtx {
  /** 本次是否全对 */
  perfect: boolean
  /** 本次连续答对峰值 */
  maxStreak: number
  /** 本次答对数 */
  right: number
  /** 任务类型 */
  kind: 'daily' | 'unit' | 'final'
  /** 任务 id */
  trackId: string
  /** 本次得分 */
  score: number
}

/** 结算：更新积分、徽章。返回新解锁的徽章列表 */
export function settle(p: Progress, ctx: AwardCtx): Badge[] {
  const newly: Badge[] = []
  const has = (id: string) => !!p.badges[id]
  const give = (id: string) => {
    if (has(id)) return
    const b = BADGES.find(x => x.id === id)
    if (b) { p.badges[id] = Date.now(); newly.push(b) }
  }

  // ── 积分 ──
  // 基础分 = 答对数 × 10，全对额外 +50，另有准确率奖励
  const base = ctx.right * 10
  const perfectBonus = ctx.perfect ? 50 : 0
  const accBonus = Math.round(ctx.score * 0.5)
  const streakBonus = ctx.maxStreak >= 10 ? 30 : 0
  p.points += base + perfectBonus + accBonus + streakBonus

  // ── 徽章 ──
  give('first')
  if (ctx.perfect) {
    give('perfect')
    const perfectCount = p.history.filter(h => h.score === 100).length + 1
    if (perfectCount >= 5) give('perfect5')
  }
  if (ctx.maxStreak >= 10) give('streak10')
  if (p.totalRight >= 100) give('w100')
  if (p.totalRight >= 368) give('w368')
  if (p.streakDays >= 10) give('d10')
  if (p.streakDays >= 30) give('d30')
  if (p.points >= 1000) give('p1000')

  if (ctx.kind === 'unit') {
    give('unit1')
    const units = new Set(
      p.history.filter(h => h.trackId.startsWith('unit')).map(h => h.trackId)
    )
    units.add(ctx.trackId)
    if (units.size >= 7) give('unit7')
  }
  if (ctx.kind === 'final') {
    give('final')
    const fins = new Set(
      p.history.filter(h => h.trackId.startsWith('final')).map(h => h.trackId)
    )
    fins.add(ctx.trackId)
    if (fins.size >= 5) give('allfinal')
  }
  if (Object.keys(p.wrong).length === 0 && p.totalAnswers > 50) give('clean')

  return newly
}

/** 等级：按积分分段 */
export function levelOf(points: number): { lv: number; name: string; cur: number; next: number } {
  const tiers = [
    { at: 0, name: '英语新手' },
    { at: 200, name: '单词学徒' },
    { at: 500, name: '拼写熟手' },
    { at: 1000, name: '词汇能手' },
    { at: 2000, name: '听写高手' },
    { at: 4000, name: '拼写大师' },
    { at: 8000, name: '词汇宗师' },
    { at: 16000, name: '英语传说' },
  ]
  let lv = 1
  for (let i = 0; i < tiers.length; i++) {
    if (points >= tiers[i].at) lv = i + 1
  }
  const cur = tiers[lv - 1].at
  const next = tiers[lv]?.at ?? cur * 2
  return { lv, name: tiers[lv - 1].name, cur, next }
}

/** 今天已学分钟数 */
export function addMinutes(p: Progress, min: number) {
  const t = todayStr()
  p.minutes[t] = Math.round(((p.minutes[t] || 0) + min) * 10) / 10
}
