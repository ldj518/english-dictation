/**
 * 词级记忆强度引擎（v4 P1）。
 *
 * 取代 reviewQueue.ts 的固定档位 [1,2,4,7,15,30]。
 *
 * 为什么换：固定档位里「错 20 次」和「错 1 次」对系统是同一件事——都退回第 0 档，
 * 然后永远走 6 档出不去。孩子错 28 次对 8 次的 look forward to 卡在 stage 0
 * 整整 20 天，根因就在这。S 是连续量，答对翻倍（间隔越来越长）、答错归 1
 * （明天必到），失误次数另记在 lapses 里决定「怎么练」而不是「什么时候练」。
 *
 * 五条规则（全部纯函数，单测在 core 里）：
 *  1. 答对：S × 2，封顶 60 天
 *  2. 有提示（hinted）或速答（fast）：S × 1.5，封顶 60 ——「看一眼就会」不算真会
 *  3. 答错：S = 1，lapses + 1，明天必到
 *  4. 毕业：S ≥ 32 且连续 3 次无提示答对 → master = 2（退出日常队列，只进月测）
 *  5. 复习档位：3 = 已掌握（S≥4）/ 2 = 学习中 / 1 = 未掌握 / 0 = 从未答对
 */

import type { Progress } from '../types'
import { bjDayKey, bjAddDays, bjDiffDays, bjDayStart } from './bj'

/** 一个词的记忆状态 */
export interface WordState {
  /** 记忆强度，单位天。决定下次到期日 */
  S: number
  /** 下次到期日 yyyy-mm-dd（北京日） */
  due: string
  /** 累计答错次数。≥4 进钉子词清单，改走多通道 */
  lapses: number
  /** 连续无提示答对次数。达到 3 且 S≥32 毕业 */
  streak: number
  /** 0 学习中 / 1 已掌握(S≥4) / 2 已毕业 */
  master: number
  /** 最近一次作答时间戳 */
  at: number
  /** 累计答对次数 */
  ok: number
  /** 累计作答次数 */
  n: number
}

export const S_MAX = 60
export const S_MASTER = 32
export const MASTER_STREAK = 3
export const LAPSES_NAIL = 4

/** 新建一个词状态（首次答对） */
export function newState(now = Date.now()): WordState {
  return { S: 1, due: bjAddDays(bjDayKey(now), 1), lapses: 0, streak: 0, master: 0, at: now, ok: 0, n: 0 }
}

/**
 * 作答通道。决定「答对」到底算什么会了。
 *
 *  认得档：pick（听音选义）/ sent（句子拼装）/ mean（句意选择）
 *    这几关的正确答案就摆在眼前，选对了只能说明「认得」，
 *    不能证明会写。所以 S 最多推到 4（刚好跨进「已掌握」的门槛），
 *    不进连续答对，永远不可能靠选择题毕业。
 *
 *  产出档：spell（拼写）/ paper（纸笔）/ dict（整句听写）
 *    从零写出来才算真会，正常翻倍、正常累计 streak、能毕业。
 *
 * 为什么必须分：原来只有一个入口，且同一个词当天只判一次（gradedRef 去重）。
 * 如果当天的识别题排在拼写题前面，这个词的记忆状态就由那一次选择题定下来了，
 * 后面真正写出来的那次反而不记——「会选被记成会写」，实测已经攒了 449 条脏数据。
 */
export type Channel = 'pick' | 'sent' | 'mean' | 'spell' | 'paper' | 'dict'

/** 认得档通道：答对只推到这个强度，不进 streak */
const RECOGNIZE_CAP = 4

function isRecognize(ch?: Channel): boolean {
  return ch === 'pick' || ch === 'sent' || ch === 'mean'
}

export interface GradeOpts {
  /** 用了提示（首字母/音节/看答案后重做）→ 只涨 1.5 倍 */
  hinted?: boolean
  /** 速答（<1.5 秒）→ 只涨 1.5 倍，不进 streak */
  fast?: boolean
  /** 作答通道，不传按产出档处理（兼容老调用点） */
  channel?: Channel
  /** 覆写当前时间（单测用） */
  now?: number
}

/**
 * 判一次词，返回新状态（不改入参）。
 * 纯函数——store 里拿返回值覆盖，单测可直接对拍。
 */
export function gradeWord(prev: WordState | undefined, correct: boolean, opts: GradeOpts = {}): WordState {
  const now = opts.now ?? Date.now()
  const cur = prev ? { ...prev } : newState(now)
  cur.at = now
  cur.n += 1

  if (!correct) {
    cur.S = 1
    cur.lapses += 1
    cur.streak = 0
    cur.master = 0
    cur.due = bjAddDays(bjDayKey(now), 1)
    return cur
  }

  cur.ok += 1

  if (isRecognize(opts.channel)) {
    // 认得档：往 4 推，但绝不往下拉。
    // 已经练到 S=8 的词，某天被选择题答对一次，不能因此降回 4——
    // 那不是「学得少了」，只是换了个通道考。
    const bump = Math.max(cur.S, Math.min(RECOGNIZE_CAP, cur.S * 1.5))
    cur.S = Math.min(S_MAX, Math.max(1, Math.round(bump * 10) / 10))
    // streak / master 只升不降：
    //  - streak 不重置，否则一个快毕业的词做了一道选择题就被打回原点，纯属冤
    //  - streak 也不递增，认得不能算独立答对，否则靠选择题就能毕业
    //  - master 跟着 S 走，但只往上抬（S≥4 算已掌握），不会被选择题抬到毕业
    if (cur.S >= 4 && cur.master < 1) cur.master = 1
    cur.due = bjAddDays(bjDayKey(now), Math.max(1, Math.round(cur.S)))
    return cur
  }

  const soft = !!opts.hinted || !!opts.fast
  const next = soft ? cur.S * 1.5 : cur.S * 2
  cur.S = Math.min(S_MAX, Math.max(1, Math.round(next * 10) / 10))

  if (!soft) cur.streak += 1
  else cur.streak = 0

  // 毕业判定：强度够了 + 连续独立答对 3 次
  if (cur.S >= S_MASTER && cur.streak >= MASTER_STREAK) cur.master = 2
  else if (cur.S >= 4) cur.master = 1
  else cur.master = 0

  cur.due = bjAddDays(bjDayKey(now), Math.max(1, Math.round(cur.S)))
  return cur
}

/** 是否是钉子词（错太多次，必须换练法） */
export function isNail(w: WordState | undefined): boolean {
  return !!w && w.lapses >= LAPSES_NAIL
}

/** 词状态表（Progress 上懒初始化，老数据没有这个字段） */
export function stateMap(p: Progress): Record<string, WordState> {
  return p.wordState || {}
}

/** 取某词状态 */
export function stateOf(p: Progress, word: string): WordState | undefined {
  return p.wordState?.[word]
}

export interface DueItem {
  word: string
  cn: string
  state: WordState
  /** 逾期天数（0 = 正好今天到期） */
  overdue: number
  /** 风险分：越高越该今天做 */
  risk: number
}

/**
 * 今天到期的词，按风险排序。
 *
 * 排序规则（方案里定的，逐条有理由）：
 *  1. 钉子词优先（lapses ≥ 4）——这批最顽固，早清早解脱
 *  2. 逾期越久越优先——放久了等于没学过
 *  3. S 越小越优先——强度低的词漏一天损失最大
 *
 * @param cnOf 词 → 中文（由调用方注入，避免循环 import words.json）
 */
export function dueWordList(
  p: Progress,
  dayKey: string,
  cnOf: (w: string) => string
): DueItem[] {
  const out: DueItem[] = []
  for (const [word, s] of Object.entries(p.wordState || {})) {
    if (s.master === 2) continue            // 毕业词不进日常队列
    // 到期 = 到期日 ≤ 今天。写成 bjDiffDays(s.due, dayKey) < 0 会把「已到期」全跳过、
    // 只留下未来到期的那些词——方向反了，队列会整个错位（实测 182 个到期只认出 46 个）。
    if (bjDiffDays(s.due, dayKey) > 0) continue   // 还没到期
    const overdue = bjDiffDays(dayKey, s.due)
    const risk =
      (isNail(s) ? 1000 : 0) +
      Math.min(overdue, 30) * 20 +
      Math.max(0, 32 - s.S) * 3 +
      s.lapses * 5
    out.push({ word, cn: cnOf(word), state: s, overdue, risk })
  }
  return out.sort((a, b) => b.risk - a.risk || a.word.localeCompare(b.word))
}

/** 未来 N 天每天到期的词数（后台柱图用） */
export function dueForecast(p: Progress, dayKey: string, days = 7): { day: string; n: number }[] {
  const cnt: Record<string, number> = {}
  for (const s of Object.values(p.wordState || {})) {
    if (s.master === 2) continue
    const d = bjDiffDays(s.due, dayKey)
    if (d < 0) { cnt[dayKey] = (cnt[dayKey] || 0) + 1; continue }
    if (d < days) cnt[s.due] = (cnt[s.due] || 0) + 1
  }
  return Array.from({ length: days }, (_, i) => {
    const d = bjAddDays(dayKey, i)
    return { day: d, n: cnt[d] || 0 }
  })
}

export interface QueueHealth {
  total: number
  due: number
  /** 未掌握（S < 4） */
  weak: number
  /** 已掌握（4 ≤ S < 32） */
  solid: number
  /** 已毕业 */
  master: number
  /** 钉子词数 */
  nails: number
  /** 平均强度 */
  avgS: number
  /** 近 7 天记录里的遗忘率（答错 / 总答） */
  forgetRate: number
}

/** 队列健康度（首页、家长后台、「今天该做什么」都用这一个口径） */
export function queueHealth(p: Progress, dayKey: string): QueueHealth {
  let due = 0, weak = 0, solid = 0, master = 0, nails = 0, sumS = 0, total = 0
  for (const s of Object.values(p.wordState || {})) {
    total += 1
    sumS += s.S
    if (s.master === 2) { master += 1; continue }
    if (s.S < 4) weak += 1
    else solid += 1
    if (s.lapses >= LAPSES_NAIL) nails += 1
    if (bjDiffDays(dayKey, s.due) >= 0) due += 1
  }
  return {
    total, due, weak, solid, master, nails,
    avgS: total ? Math.round((sumS / total) * 10) / 10 : 0,
    forgetRate: forgetRate(p, dayKey),
  }
}

/**
 * 近 7 天遗忘率 = 答错 / 总答（用 history 里的逐题记录算，不用 S）。
 * 用来决定新词额度：遗忘率高就减新词，低就加。
 */
export function forgetRate(p: Progress, dayKey: string, days = 7): number {
  const from = bjDayStart(bjAddDays(dayKey, -days + 1))
  let t = 0, r = 0
  for (const h of p.history || []) {
    if (h.at < from) continue
    t += h.total
    r += h.right
  }
  if (!t) return 0
  return Math.round(((t - r) / t) * 100) / 100
}

/**
 * 从旧数据反推初始 S（迁移用，纯函数，dry-run 也能跑）。
 *
 * 映射规则：
 *  - review 队列里的词：S = [1,2,4,7,15,30][stage]
 *  - 错词本里的词：S = 1，lapses = 错次数（它们本来就要重新爬）
 *  - reviewDone 里的词：master = 2，S = 32（走完全曲线的）
 * 其余学过的词不建状态——没进过任何队列 = 系统没记录过它的记忆强度，
 * 凭空给一个数会让首日队列失真。它们会在下次遇到时自然建状态。
 */
export function migrateFromLegacy(p: Progress): Record<string, WordState> {
  const STAGES = [1, 2, 4, 7, 15, 30]
  const out: Record<string, WordState> = {}
  const day = bjDayKey()

  for (const [word, r] of Object.entries(p.review || {})) {
    const S = STAGES[Math.min(STAGES.length - 1, Math.max(0, r.stage || 0))]
    out[word] = {
      S, due: bjDayKey(r.dueAt || Date.now()),
      lapses: 0, streak: 0,
      master: S >= S_MASTER ? 2 : S >= 4 ? 1 : 0,
      at: r.addedAt || Date.now(), ok: 0, n: 0,
    }
  }
  for (const [word, w] of Object.entries(p.wrong || {})) {
    const prev = out[word]
    out[word] = {
      S: 1,
      // 到期日沿用老队列里那条（可能已经逾期），没有才排到明天。
      // 原来写成「未来的就保留、否则明天」，结果是迁移时把所有逾期词集体推到明天——
      // 首日只认出 31 个到期，第二天突然冒出 136 个，把清账期整个错开一天。
      due: prev?.due || bjAddDays(day, 1),
      lapses: Math.max(1, w.count || 1),
      streak: 0, master: 0,
      at: w.lastAt || Date.now(),
      ok: w.okCount || 0, n: (w.okCount || 0) + (w.count || 0),
    }
  }
  for (const [word, at] of Object.entries(p.reviewDone || {})) {
    out[word] = {
      S: S_MASTER, due: bjAddDays(day, S_MASTER),
      lapses: out[word]?.lapses || 0, streak: MASTER_STREAK, master: 2,
      at: at || Date.now(), ok: out[word]?.ok || 0, n: out[word]?.n || 0,
    }
  }
  return out
}

/** 迁移后的一致性断言（跑完检查，不通过就别上线） */
export function assertMigration(
  p: Progress, state: Record<string, WordState>
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  const keys = new Set([
    ...Object.keys(p.review || {}),
    ...Object.keys(p.wrong || {}),
    ...Object.keys(p.reviewDone || {}),
  ])
  for (const k of keys) {
    if (!state[k]) problems.push(`缺状态：${k}`)
    else if (!state[k].due) problems.push(`缺到期日：${k}`)
  }
  const extra = Object.keys(state).filter(k => !keys.has(k))
  if (extra.length) problems.push(`多出 ${extra.length} 个词：${extra.slice(0, 5).join(',')}`)
  return { ok: problems.length === 0, problems }
}
