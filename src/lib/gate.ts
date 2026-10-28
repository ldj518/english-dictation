/**
 * 测验体系（v5 P4）：单元闸门 + 补丁期。
 *
 * 方案定的原则：**按掌握度触发，不按日历**。所以这里没有「学完第 3 单元就考」，
 * 只有四条硬条件全满足才放考；不通过也不是重考同一张卷，而是进 3 天补丁期，
 * 期间入口灰掉、只补该单元的弱词，补完再考（最多 3 次，之后转线下）。
 */

import { WORDS } from './data'
import type { Progress, TestRun } from '../types'
import { bjAddDays, bjDiffDays, bjDayKey } from './bj'
import { dueWordList } from './memory'
import {
  cnOf, spellHint, makeOptions, SENTENCES, splitTokens,
  type Q,
} from './qbank'
import { seededShuffle } from './shuffle'

export const GATE_PASS = 80          // 总分通过线
export const SPELL_PASS = 70         // 拼写段通过线（写不出等于没学会）
export const PATCH_DAYS = 3          // 不通过 → 补丁期天数
export const GATE_MAX_TRY = 3        // 连续 3 次不过转线下

export const UNITS = ['unit01', 'unit02', 'unit03', 'unit04', 'unit05', 'unit06', 'unit07']

/** 单元显示名（首页卡、闸门页、家长后台、战报统一用它，别各写一份） */
export const UNIT_NAME: Record<string, string> = {
  unit01: '第 1 单元', unit02: '第 2 单元', unit03: '第 3 单元', unit04: '第 4 单元',
  unit05: '第 5 单元', unit06: '第 6 单元', unit07: '第 7 单元',
}

export function unitName(u?: string): string {
  if (!u) return '周测'
  return UNIT_NAME[u] || u
}

/** 某单元的全部词（按词表顺序，天然是教材顺序） */
export function unitWords(unit: string): string[] {
  return WORDS.filter(w => (w.unit || 'extra') === unit).map(w => w.word)
}

export interface GateStats {
  unit: string
  total: number
  learned: number
  solid: number
  weak: number
  due: number
  /** 距该单元最近一次作答的天数；没学过返回 999 */
  lastGap: number
}

/** 单元掌握概况（首页/闸门页都用它，口径唯一） */
export function gateStats(p: Progress, unit: string, dayKey: string): GateStats {
  const ws = unitWords(unit)
  let learned = 0, solid = 0, weak = 0, due = 0, lastAt = 0
  for (const w of ws) {
    const s = p.wordState?.[w]
    if (!s) continue
    learned++
    if (s.master === 2 || s.S >= 4) solid++
    else weak++
    if (bjDiffDays(dayKey, s.due) >= 0) due++
    lastAt = Math.max(lastAt, s.at || 0)
  }
  const lastGap = lastAt ? Math.max(0, bjDiffDays(dayKey, bjDayKey(lastAt))) : 999
  return { unit, total: ws.length, learned, solid, weak, due, lastGap }
}

/** 补丁期还剩几天（0 = 不在补丁期） */
export function patchLeft(p: Progress, unit: string, dayKey: string): number {
  const runs = (p.tests || []).filter(t => t.kind === 'gate' && t.unit === unit)
  if (!runs.length) return 0
  const last = runs[runs.length - 1]
  if (last.pass) return 0
  if (!last.patchUntil) return 0
  const d = bjDiffDays(last.patchUntil, dayKey)
  return d > 0 ? d : 0
}

/** 该单元已考过几次（含不过的） */
export function attemptOf(p: Progress, unit: string): number {
  return (p.tests || []).filter(t => t.kind === 'gate' && t.unit === unit).length
}

export interface GateGate {
  unit: string
  ready: boolean
  /** 不考的原因，直接显示给家长 */
  why: string
  stats: GateStats
  patchLeft: number
  attempt: number
  passed: boolean
}

/**
 * 四条触发条件（缺一不考）：
 *  ① 本单元学过 ≥ 80%
 *  ② S≥4 的占比 ≥ 50%
 *  ③ 距本单元最近一次作答 ≥ 1 天（刚学完就考＝考短时记忆，不算）
 *  ④ 全库到期词 ≤ 20（清账期不加考，先清账）
 */
export function gateOf(p: Progress, unit: string, dayKey: string, dueAll?: number): GateGate {
  const stats = gateStats(p, unit, dayKey)
  const patch = patchLeft(p, unit, dayKey)
  const attempt = attemptOf(p, unit)
  const passed = (p.tests || []).some(t => t.kind === 'gate' && t.unit === unit && t.pass)
  const dueTotal = typeof dueAll === 'number' ? dueAll : dueWordList(p, dayKey, cnOf).length

  const reasons: string[] = []
  if (passed) reasons.push('已通过')
  else if (attempt >= GATE_MAX_TRY) reasons.push('连考 3 次未过，转线下补')
  else if (patch > 0) reasons.push(`补丁期还剩 ${patch} 天`)
  else {
    if (stats.total === 0) reasons.push('本单元没有词')
    else if (stats.learned / stats.total < 0.8) reasons.push(`本单元还有 ${stats.total - stats.learned} 个词没学过`)
    if (stats.learned && stats.solid / stats.learned < 0.5) reasons.push('S≥4 的词不到一半，先再练一轮')
    if (stats.lastGap < 1) reasons.push('今天刚学过本单元，隔一天再考')
    if (dueTotal > 20) reasons.push(`还有 ${dueTotal} 个词到期，先清账`)
  }
  return { unit, ready: reasons.length === 0, why: reasons.join('；'), stats, patchLeft: patch, attempt, passed }
}

/** 找一个今天该考的单元（按单元顺序，第一个 ready 的） */
export function nextGate(p: Progress, dayKey: string, dueAll?: number): GateGate | null {
  for (const u of UNITS) {
    const g = gateOf(p, u, dayKey, dueAll)
    if (g.ready) return g
  }
  return null
}

/**
 * 组卷：从单元词里按「钉子 → 逾期久 → S 小」抽 30 个，
 * 12 拼写 + 12 听音选义 + 3 句子 + 3 纸笔。词不够就全用（至少 10 题）。
 */
export function buildPaper(
  p: Progress, words: string[], seed: string, kind: 'gate' | 'week' = 'gate',
): Q[] {
  const pool = words.slice()
  const ranked = pool
    .map(w => {
      const s = p.wordState?.[w]
      const risk =
        (s && s.lapses >= 4 ? 1000 : 0) +
        (s ? Math.max(0, 32 - s.S) * 3 : 0) +
        (s && bjDiffDays(bjDayKey(), s.due) > 0 ? 30 : 0)
      return { word: w, risk }
    })
    .sort((a, b) => b.risk - a.risk || a.word.localeCompare(b.word))
    .map(x => x.word)

  const want = Math.min(30, ranked.length)
  const picked = ranked.slice(0, want)
  const nSpell = Math.max(4, Math.round(want * 0.4))
  const nPick = Math.max(4, Math.round(want * 0.4))
  const nSent = want >= 20 ? 3 : 1
  const nPaper = Math.max(1, want - nSpell - nPick - nSent)

  const spellW = picked.slice(0, nSpell)
  const pickW = picked.slice(nSpell, nSpell + nPick)
  const sentW = picked.slice(nSpell + nPick, nSpell + nPick + nSent)
  const paperW = picked.slice(nSpell + nPick + nSent, nSpell + nPick + nSent + nPaper)

  const qs: Q[] = []
  let n = 0
  const push = (q: Omit<Q, 'id' | 'seg'>) => { qs.push({ ...q, id: 't' + (n++), seg: 0 } as Q) }

  spellW.forEach((w, i) => {
    const { hint, len } = spellHint(w)
    push({
      kind: 'spell', segKind: 'spell', word: w, cn: cnOf(w), file: null,
      scored: true, must: true, hint, len,
    })
    void i
  })
  pickW.forEach(w => {
    const { options, answerKey } = makeOptions(w, `${seed}|pick|${w}`)
    push({
      kind: 'pick', segKind: 'choice', word: w, cn: cnOf(w), file: null,
      scored: true, must: true, options, answerKey,
    })
  })
  sentW.forEach(w => {
    const sen = SENTENCES[w]
    if (!sen) return
    const tokens = splitTokens(sen.en)
    let order = seededShuffle(tokens.map((_, i) => i), `${seed}|sent|${w}`)
    for (let k = 0; k < 6 && order.filter((v, i) => v === i).length > tokens.length - 3; k++) {
      order = seededShuffle(order, `${seed}|sent|${w}|${k}`)
    }
    push({
      kind: 'sent', segKind: 'sent', word: w, cn: sen.cn, file: null,
      scored: true, must: true, en: sen.en, tokens, order, tip: sen.tip,
    })
  })
  paperW.forEach(w => {
    push({
      kind: 'paper', segKind: 'paper', word: w, cn: cnOf(w), file: null,
      scored: true, must: true,
    })
  })
  void kind
  return qs
}

/** 逐题记录（落 test_items 用） */
export interface TestItem {
  no: number
  word: string
  qkind: string
  correct: boolean
  peek: boolean
  ms: number
  fast: boolean
}

export interface PaperResult {
  total: number
  right: number
  peekN: number
  score: number
  spellTotal: number
  spellRight: number
  spellScore: number
  pass: boolean
}

/**
 * 判卷。
 * 分数口径和日常会话一致：首答对 ÷（总题 − 看答案题）。
 * 但闸门多一条：拼写段单独 ≥70，因为「会选不会写」在这套系统里不算过关。
 */
export function gradePaper(
  recs: { kind: string; correct: boolean; peek?: boolean }[],
): PaperResult {
  const noPeek = recs.filter(r => !r.peek)
  const right = noPeek.filter(r => r.correct).length
  const score = noPeek.length ? Math.round((right / noPeek.length) * 100) : 0
  const sp = recs.filter(r => r.kind === 'spell')
  const spOk = sp.filter(r => r.correct && !r.peek).length
  const spellScore = sp.length ? Math.round((spOk / sp.length) * 100) : 100
  return {
    total: recs.length, right, peekN: recs.filter(r => r.peek).length,
    score, spellTotal: sp.length, spellRight: spOk, spellScore,
    pass: score >= GATE_PASS && spellScore >= SPELL_PASS,
  }
}

/** 一次考试 → 可落库的 TestRun */
export function makeRun(
  kind: 'gate' | 'week', unit: string | undefined, dayKey: string,
  r: PaperResult, attempt: number, id: string, at = Date.now(),
): TestRun {
  return {
    id, kind, unit, dayKey,
    total: r.total, right: r.right, peekN: r.peekN,
    score: r.score, spellScore: r.spellScore,
    pass: r.pass, passLine: GATE_PASS,
    attempt,
    patchUntil: r.pass ? undefined : bjAddDays(dayKey, PATCH_DAYS),
    at,
  }
}

/** 补丁期该练的词：本单元 S 最小 + lapses 最多的 10 个 */
export function patchWords(p: Progress, unit: string, n = 10): string[] {
  return unitWords(unit)
    .map(w => {
      const s = p.wordState?.[w]
      const score = (s ? s.S : 0) - (s ? s.lapses * 2 : 0)
      return { w, score }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map(x => x.w)
}
