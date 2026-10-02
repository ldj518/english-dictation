/**
 * 跨设备数据合并（v2.6）。
 *
 * 背景：此前身份档案（名字/头像）和进度（积分/错词本/成绩）只存本机 localStorage，
 * 换一台设备就「失忆」——用户报告改了名字别的客户端不变。
 *
 * 原则：localStorage 仍是第一真相源；云端快照用于「合并」，不用「覆盖」，
 * 合并规则全部是无损的（取高分/取最大值/并集），两边各做各的也能收敛到同一份。
 */
import type { Progress, Profile, WrongWord } from '../types'
import { fetchStudents, fetchProgressSnapshot, pushProgressSnapshot, syncStudent } from './api'
import { load, save, saveProfiles } from './storage'

/* ── 身份档案：云端为准 ─────────────────────────────────────────── */

/**
 * 用云端 students 合并本地身份列表：
 * - 名字/头像/颜色：云端为准（改名后别的设备能跟上）
 * - 云端有、本地没有 → 追加（新设备自动补档案）
 * - 本地有、云端没有 → 保留并推到云端（本地刚建还没同步出去）
 */
export async function syncProfiles(local: Profile[]): Promise<{ profiles: Profile[]; changed: boolean }> {
  const remote = await fetchStudents()          // 网络不通返回 []
  if (!remote.length) return { profiles: local, changed: false }
  const out = local.map(p => ({ ...p }))
  let changed = false

  const remoteIds = new Set<string>()
  for (const r of remote) {
    remoteIds.add(r.id)
    const i = out.findIndex(p => p.id === r.id)
    if (i >= 0) {
      // 云端为准覆盖展示信息（本地刚编辑过会推到云端，下次拉取一致）
      if (out[i].name !== r.name || out[i].emoji !== r.emoji || out[i].color !== r.color) {
        out[i] = { ...out[i], name: r.name, emoji: r.emoji, color: r.color }
        changed = true
      }
    } else {
      out.push({ id: r.id, name: r.name, emoji: r.emoji, color: r.color })
      changed = true
    }
  }
  // 本地独有的推上去
  for (const p of out) {
    if (!remoteIds.has(p.id)) void syncStudent(p)
  }
  if (changed) saveProfiles(out)
  return { profiles: out, changed }
}

/* ── 进度：字段级无损合并 ───────────────────────────────────────── */

const byIdKey = (h: { trackId: string; at: number; total: number; right: number }) =>
  `${h.trackId}|${h.at}|${h.total}|${h.right}`

/** 合并两份进度。a=本地，b=云端。settings 用 a（设备本地偏好不互相踩） */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const max = (x: number, y: number) => Math.max(x || 0, y || 0)

  const best: Progress['best'] = { ...b.best }
  for (const [k, v] of Object.entries(a.best)) {
    const r = best[k]
    if (!r || v.score > r.score) best[k] = v
  }
  const attempts: Progress['attempts'] = { ...b.attempts }
  for (const [k, v] of Object.entries(a.attempts)) {
    attempts[k] = max(attempts[k] || 0, v)
  }
  const badges: Progress['badges'] = { ...b.badges }
  for (const [k, v] of Object.entries(a.badges)) {
    badges[k] = max(badges[k] || 0, v)
  }
  const minutes: Progress['minutes'] = { ...b.minutes }
  for (const [k, v] of Object.entries(a.minutes)) {
    minutes[k] = max(minutes[k] || 0, v)
  }
  // 错词本：错误次数多的那条整条胜（count 相同取本地）
  const wrong: Record<string, WrongWord> = { ...b.wrong }
  for (const [k, v] of Object.entries(a.wrong)) {
    const r = wrong[k]
    if (!r || v.count >= r.count) wrong[k] = v
  }
  // 历史：合并去重，按时间倒序截断
  const seen = new Set<string>()
  const history = [...a.history, ...b.history]
    .filter(h => {
      const key = byIdKey(h)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((x, y) => y.at - x.at)
    .slice(0, 200)

  // 学习环节（v2.7）：次数取多、时间取新、奖励日取非空（同天奖励两边都记了值相同）
  const learned: Progress['learned'] = { ...b.learned }
  for (const [k, v] of Object.entries(a.learned || {})) {
    const r = learned[k]
    if (!r) { learned[k] = v; continue }
    learned[k] = {
      count: max(r.count || 0, v.count || 0),
      at: Math.max(r.at || 0, v.at || 0),
      bonusDay: v.bonusDay || r.bonusDay,
    }
  }

  // 复习队列（v3.1）：每词保留进度更远的一档；同档取到期更早的（更保守，宁可多复习）
  const review: Progress['review'] = { ...(a.review || {}) }
  for (const [k, v] of Object.entries(b.review || {})) {
    const r = review[k]
    if (!r) { review[k] = v; continue }
    if (v.stage > r.stage || (v.stage === r.stage && v.dueAt < r.dueAt)) review[k] = v
  }

  // 已毕业词（v3.2）：并集，毕业时间取更早的（无损合并）
  const reviewDone: NonNullable<Progress['reviewDone']> = { ...(a.reviewDone || {}) }
  for (const [k, v] of Object.entries(b.reviewDone || {})) {
    reviewDone[k] = Math.min(reviewDone[k] ?? Infinity, v)
  }

  // 每日计划账本（v3.3）：并集，同一天取更早的完成日期（首次完成语义）
  const planLog: NonNullable<Progress['planLog']> = { ...(a.planLog || {}) }
  for (const [k, v] of Object.entries(b.planLog || {})) {
    const key = Number(k)
    planLog[key] = planLog[key] && planLog[key] < v ? planLog[key] : v
  }

  // 完美一天奖励（v3.3）：并集（true 即发过）
  const trioDone: NonNullable<Progress['trioDone']> = { ...(a.trioDone || {}) }
  for (const [k, v] of Object.entries(b.trioDone || {})) {
    trioDone[k] = trioDone[k] || v
  }

  // 单元过关记录（v3.4）：同单元取分数高者；同分取更早的过关时间（首次过关语义）
  const passed: NonNullable<Progress['passed']> = { ...(a.passed || {}) }
  for (const [k, v] of Object.entries(b.passed || {})) {
    const cur = passed[k]
    if (!cur) { passed[k] = v; continue }
    passed[k] = v.score > cur.score ? v : (v.score === cur.score && v.at < cur.at ? v : cur)
  }

  // 闯关进度（v3.5）：同一天取 step 大者（只进不退）
  const flow: NonNullable<Progress['flow']> = { ...(a.flow || {}) }
  for (const [k, v] of Object.entries(b.flow || {})) {
    const cur = flow[k]
    flow[k] = !cur || v.step > cur.step ? v : cur
  }

  // streakDays/lastDay 跟连续天数大的一方走
  const streakLocal = a.streakDays || 0
  const streakRemote = b.streakDays || 0

  return {
    best,
    attempts,
    wrong,
    points: max(a.points, b.points),
    streakDays: Math.max(streakLocal, streakRemote),
    lastDay: streakLocal >= streakRemote ? a.lastDay : b.lastDay,
    badges,
    totalAnswers: max(a.totalAnswers, b.totalAnswers),
    totalRight: max(a.totalRight, b.totalRight),
    history,
    minutes,
    planDone: max(a.planDone, b.planDone),
    learned,
    review,
    reviewDone,
    planLog,
    trioDone,
    passed,
    flow,
    settings: { ...a.settings },
  }
}

/** 需要保存/更新的判定：内容不同才算（JSON 级比较，进度对象小，代价可忽略） */
export function progressChanged(a: Progress, b: Progress): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * 拉云端快照并合并进本地。返回合并后的进度；云端没有/网络不通返回 null（不动本地）。
 * 合并出的结果同时回推云端（让其他设备尽快看到并集）。
 */
export async function pullAndMerge(profileId: string): Promise<Progress | null> {
  const snap = await fetchProgressSnapshot(profileId)
  if (!snap || typeof snap !== 'object') return null
  const local = load(profileId)
  const merged = mergeProgress(local, snap as Progress)
  if (!progressChanged(local, merged)) return null
  save(merged, profileId)
  void pushProgressSnapshot(profileId, merged)
  return merged
}
