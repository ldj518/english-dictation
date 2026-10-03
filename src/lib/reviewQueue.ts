import type { Progress } from '../types'

/**
 * 全词复习队列（v3.1）：艾宾浩斯遗忘曲线全词化。
 *
 * 以前只有错词本有遗忘曲线（1→2→4→7→15→30 天），答对一次的词从此没人管。
 * 现在：会话里答对的词自动入队，按同一条曲线排期回炉——
 * 答对推进一档，答错退回第一档，走完 30 天档答对即毕业。
 */
export const REVIEW_STAGES = [1, 2, 4, 7, 15, 30]
const DAY = 86400000

/** 词首次答对入队：明天复习第一次。已毕业的词不再入队（v3.2 修复：否则队列永不收敛） */
export function enqueueReview(np: Progress, word: string): void {
  if (np.review[word]) return
  if (np.reviewDone?.[word]) return
  np.review[word] = { stage: 0, dueAt: Date.now() + REVIEW_STAGES[0] * DAY, addedAt: Date.now() }
}

/** 到期复习答对：推进一档；走完最后一档毕业（出队并记入 reviewDone），返回是否毕业 */
export function advanceReview(np: Progress, word: string): boolean {
  const r = np.review[word]
  if (!r) return false
  if (r.stage >= REVIEW_STAGES.length - 1) {
    delete np.review[word]
    if (!np.reviewDone) np.reviewDone = {}
    np.reviewDone[word] = Date.now()
    return true
  }
  r.stage += 1
  r.dueAt = Date.now() + REVIEW_STAGES[r.stage] * DAY
  return false
}

/** 复习答错：退回第一档（明天重来），配合错词本 */
export function resetReview(np: Progress, word: string): void {
  const r = np.review[word]
  if (!r) return
  r.stage = 0
  r.dueAt = Date.now() + REVIEW_STAGES[0] * DAY
}

/**
 * 毕业词答错：重新走一遍曲线（v3.2）。
 * 毕业只说明「以前记住过」，日常听写再错说明忘了——清掉毕业标记，明天重新开始。
 */
export function reopenReview(np: Progress, word: string): void {
  if (np.reviewDone) delete np.reviewDone[word]
  if (np.review[word]) return
  np.review[word] = { stage: 0, dueAt: Date.now() + REVIEW_STAGES[0] * DAY, addedAt: Date.now() }
}

export interface DueReview { word: string; stage: number; dueAt: number }

/**
 * 按天判到期（v3.8）：dueAt 的「日历日」≤ 今天即算到期。
 * 以前用精确时刻比较（dueAt <= now），晚上 8 点答对的词次日晚 8 点才到期，
 * 孩子早上复习点进去是空的——家长以为功能坏了（实测踩坑）。
 * 改按天后，旧数据里的精确时刻 dueAt 也自动被「日历日」语义覆盖，无需迁移。
 */
export function isDueByDay(dueAt: number): boolean {
  const a = new Date(dueAt)
  const b = new Date()
  const key = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  return key(a) <= key(b)
}

/** 今天到期的复习词（按到期先后排）。中文释义由调用方查 WORD_MAP（防循环 import） */
export function dueReviews(p: Progress): DueReview[] {
  return Object.entries(p.review || {})
    .filter(([, r]) => isDueByDay(r.dueAt))
    .sort((a, b) => a[1].dueAt - b[1].dueAt)
    .map(([word, r]) => ({ word, stage: r.stage, dueAt: r.dueAt }))
}

/** 队列总量与到期数（家长看板/首页用） */
export function reviewSummary(p: Progress): { inQueue: number; due: number } {
  return { inQueue: Object.keys(p.review || {}).length, due: dueReviews(p).length }
}
