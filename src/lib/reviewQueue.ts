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

/** 词首次答对入队：明天复习第一次 */
export function enqueueReview(np: Progress, word: string): void {
  if (np.review[word]) return
  np.review[word] = { stage: 0, dueAt: Date.now() + REVIEW_STAGES[0] * DAY, addedAt: Date.now() }
}

/** 到期复习答对：推进一档；走完最后一档毕业（出队），返回是否毕业 */
export function advanceReview(np: Progress, word: string): boolean {
  const r = np.review[word]
  if (!r) return false
  if (r.stage >= REVIEW_STAGES.length - 1) {
    delete np.review[word]
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

export interface DueReview { word: string; stage: number; dueAt: number }

/** 今天到期的复习词（按到期先后排）。中文释义由调用方查 WORD_MAP（防循环 import） */
export function dueReviews(p: Progress): DueReview[] {
  const now = Date.now()
  return Object.entries(p.review || {})
    .filter(([, r]) => r.dueAt <= now)
    .sort((a, b) => a[1].dueAt - b[1].dueAt)
    .map(([word, r]) => ({ word, stage: r.stage, dueAt: r.dueAt }))
}

/** 队列总量与到期数（家长看板/首页用） */
export function reviewSummary(p: Progress): { inQueue: number; due: number } {
  return { inQueue: Object.keys(p.review || {}).length, due: dueReviews(p).length }
}
