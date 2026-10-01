import type { Progress, WrongWord } from '../types'

/** 遗忘曲线间隔（天）：1 / 2 / 4 / 7 / 15 / 30 */
export const REVIEW_STAGES = [1, 2, 4, 7, 15, 30]

const KEY = 'eng-dict-v1'

export const defaultProgress = (): Progress => ({
  best: {},
  attempts: {},
  wrong: {},
  points: 0,
  streakDays: 0,
  lastDay: '',
  badges: {},
  totalAnswers: 0,
  totalRight: 0,
  history: [],
  minutes: {},
  settings: { rate: 1, repeat: 2, gap: 4, voiceMode: 'normal' },
})

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultProgress()
    const p = JSON.parse(raw) as Progress
    return { ...defaultProgress(), ...p, settings: { ...defaultProgress().settings, ...(p.settings || {}) } }
  } catch {
    return defaultProgress()
  }
}

export function save(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch { /* 存储满/隐私模式，忽略 */ }
}

export function reset() {
  localStorage.removeItem(KEY)
}

export function todayStr(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const DAY = 86400000

/** 把一个词加入错词本（或提升错误次数、重置复习阶段） */
export function addWrong(p: Progress, word: string, cn: string): Progress {
  const now = Date.now()
  const cur: WrongWord = p.wrong[word] || {
    word, cn, count: 0, streak: 0, addedAt: now, lastAt: now, dueAt: now, stage: 0,
  }
  cur.count += 1
  cur.streak = 0
  cur.stage = 0
  cur.lastAt = now
  cur.dueAt = now + REVIEW_STAGES[0] * DAY
  p.wrong[word] = cur
  return p
}

/** 复习答对：推进阶段；满级后移出错词本 */
export function advanceWrong(p: Progress, word: string): { p: Progress; graduated: boolean } {
  const cur = p.wrong[word]
  if (!cur) return { p, graduated: false }
  cur.streak += 1
  cur.lastAt = Date.now()
  if (cur.stage >= REVIEW_STAGES.length - 1) {
    delete p.wrong[word]
    return { p, graduated: true }
  }
  cur.stage += 1
  cur.dueAt = Date.now() + REVIEW_STAGES[cur.stage] * DAY
  return { p, graduated: false }
}

/** 取今天该复习的错词 */
export function dueWrongWords(p: Progress): WrongWord[] {
  const now = Date.now()
  return Object.values(p.wrong)
    .filter(w => w.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
}

/** 打卡：返回是否新的一天 */
export function checkIn(p: Progress): boolean {
  const t = todayStr()
  if (p.lastDay === t) return false
  const y = todayStr(new Date(Date.now() - DAY))
  p.streakDays = p.lastDay === y ? p.streakDays + 1 : 1
  p.lastDay = t
  return true
}

/** 判断答案是否正确（宽松判分：忽略大小写、首尾空格、多余空格、常见标点） */
export function judge(input: string, answer: string): boolean {
  const norm = (s: string) =>
    s.trim().toLowerCase()
      .replace(/[.,!?;:'"]/g, '')
      .replace(/\s+/g, ' ')
  return norm(input) === norm(answer) && norm(input).length > 0
}
