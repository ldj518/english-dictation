/**
 * 句子库（课文原句）与选句算法。
 *
 * 为什么要有这一层：
 *  听写里原本的句子题用的是 `sentences.json` 里「给每个单词造一句」的人造句，
 *  和课文完全无关。孩子在课文页读过、听过的句子，第二天听写里一句都不会出现。
 *  这一层把两边接上：句子的来源是课本原句，当天挑哪几句由「今天在学哪些词」决定。
 *
 * 选句的三条规矩（按优先级）：
 *  1. 含今天的新词 —— 新词当天有语境支撑，比孤立背拼写有效
 *  2. 含钉子词（错 4 次以上）—— 这批词光靠重复拼写永远过不去，必须换语境
 *  3. 含今天到期的旧词 —— 旧词复现
 *  一条都不满足的句子只有在凑不够数时才用，不会主动挑。
 *
 * 跨天不重复靠「日序轮转」：同分候选按 (序号 - 日序×句数) 取模排序，
 * 相邻两天错开整整一批，八天轮完一个单元。不写任何状态，刷新页面不会换句。
 */
import unit01 from '../data/sentbank/unit01.json'
import unit02 from '../data/sentbank/unit02.json'
import unit03 from '../data/sentbank/unit03.json'
import unit04 from '../data/sentbank/unit04.json'
import unit05 from '../data/sentbank/unit05.json'
import unit06 from '../data/sentbank/unit06.json'
import unit07 from '../data/sentbank/unit07.json'
import { hashSeed, seededShuffle } from './shuffle'
import { bjDayKey } from './bj'

export type SentLevel = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export interface SentBankItem {
  id: string
  en: string
  cn: string
  cnFixed?: boolean
  level: SentLevel
  /** 语法特征标签：past / progressive / modal / therebe / clause / quote / neg / future */
  gram: string[]
  /** 这一句覆盖的词表词（原形） */
  words: string[]
  /** 意群块。长度 1 表示这句不适合做拼装题 */
  blocks: string[]
  src: 'text'
  /** 在单元原始语料里的序号，查音频用 */
  no: number
  ms0: number
  ms1: number
}

export interface SentUnit {
  version: number
  unit: string
  unitName: string
  sents: SentBankItem[]
}

const UNITS: Record<string, SentUnit> = {
  unit01: unit01 as unknown as SentUnit,
  unit02: unit02 as unknown as SentUnit,
  unit03: unit03 as unknown as SentUnit,
  unit04: unit04 as unknown as SentUnit,
  unit05: unit05 as unknown as SentUnit,
  unit06: unit06 as unknown as SentUnit,
  unit07: unit07 as unknown as SentUnit,
}

export function getSentUnit(unit: string): SentUnit | null {
  return UNITS[unit] || null
}

export function sentUnitIds(): string[] {
  return Object.keys(UNITS).filter(u => (UNITS[u]?.sents.length || 0) > 0)
}

/** 全部句子（跨单元，兜底用） */
export function allSents(): SentBankItem[] {
  return Object.values(UNITS).flatMap(u => u.sents)
}

/** 句子挂的词 → 反查：某个词出现过在哪些句子里 */
const BY_WORD: Map<string, SentBankItem[]> = (() => {
  const m = new Map<string, SentBankItem[]>()
  for (const u of Object.values(UNITS)) {
    for (const s of u.sents) {
      for (const w of s.words) {
        const arr = m.get(w) || []
        arr.push(s)
        m.set(w, arr)
      }
    }
  }
  return m
})()

/** 含某个词的句子（词表原形精确匹配） */
export function sentsOfWord(word: string): SentBankItem[] {
  return BY_WORD.get(word) || []
}

/* ── 选句 ─────────────────────────────────────────── */

export type SentUse = 'block' | 'mean'

export interface PickOpts {
  /** 当前在学单元；没数据就自动落到有数据的单元 */
  unit: string
  dayKey: string
  /** 用来算日序轮转，保证同一天同一身份选出来的一样 */
  profileId: string
  /** 今天的新词 */
  newWords: string[]
  /** 钉子词（lapses ≥ 4） */
  nailWords?: string[]
  /** 今天到期的旧词 */
  dueWords?: string[]
  /** 要几句 */
  count: number
  /** block = 意群拼装（只要 ≥2 块的）；mean = 句意选择（不限） */
  use: SentUse
  /** 当天已出过的句子 id，避免同一批重复 */
  used?: string[]
}

/** 句子是否含某个词表词。先查预计算的 words，再退回文本匹配（跨单元复习时用） */
function hasWord(s: SentBankItem, w: string): boolean {
  if (s.words.includes(w)) return true
  const en = s.en.toLowerCase()
  const lw = w.toLowerCase()
  if (lw.includes(' ')) return en.includes(lw)
  return new RegExp('\\b' + lw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es|ed|ing|d)?\\b').test(en)
}

/** 块数对应的难度分：2-3 块最合适，1 块不能拼，5 块太长 */
function blockScore(n: number): number {
  if (n <= 1) return -1000
  if (n === 2) return 30
  if (n === 3) return 34
  if (n === 4) return 22
  return 8
}

/** 句意选择的难度偏好：问句和含从句的最有辨析价值，短陈述句太直白 */
function meanScore(lv: SentLevel): number {
  if (lv === 'S2') return 26
  if (lv === 'S4') return 24
  if (lv === 'S5') return 16
  if (lv === 'S3') return 18
  return 0
}

/** 日序：同一个月内每天推进一批；跨月从 1 号重新数（句子不是选择题，可预测也没用） */
function dayIndex(dayKey: string): number {
  const d = parseInt(dayKey.slice(8, 10), 10)
  return Number.isFinite(d) ? d - 1 : 0
}

/**
 * 挑当天该出的句子。
 *
 * 返回的顺序不是难度顺序——按「挂词分 + 日序轮转」混排，
 * 孩子看不出「先易后难」的规律，也就不会在难句前提前泄气。
 */
export function pickSents(opts: PickOpts): SentBankItem[] {
  const unit = getSentUnit(opts.unit) || getSentUnit(sentUnitIds()[0])
  if (!unit) return []
  const used = new Set(opts.used || [])
  const news = opts.newWords.map(w => w.toLowerCase())
  const nails = (opts.nailWords || []).map(w => w.toLowerCase())
  const dues = (opts.dueWords || []).map(w => w.toLowerCase())

  // 候选池：过掉当天已用的
  let pool = unit.sents.filter(s => !used.has(s.id))
  if (opts.use === 'block') pool = pool.filter(s => s.blocks.length >= 2)
  if (!pool.length) pool = unit.sents.filter(s => !used.has(s.id))
  if (!pool.length) return []

  const n0 = pool.length
  const rot = (dayIndex(opts.dayKey) * Math.max(1, opts.count)) % n0
  // 稳定的基准顺序：同一天同一身份永远一样，换天换身份才变
  const base = seededShuffle(pool, `sb|${opts.unit}|${opts.profileId}`)
  const rotIdx = new Map<string, number>()
  base.forEach((s, i) => rotIdx.set(s.id, (i - rot + n0 * 2) % n0))

  const scored = pool.map(s => {
    let sc = 0
    for (const w of news) if (hasWord(s, w)) sc += 100
    for (const w of nails) if (hasWord(s, w)) sc += 60
    for (const w of dues) if (hasWord(s, w)) sc += 30
    sc += opts.use === 'block' ? blockScore(s.blocks.length) : meanScore(s.level)
    // 长度惩罚：20 词的长句在手机上要滚屏，拼装题尤其难受
    if (s.en.split(/\s+/).length > 15) sc -= 12
    return { s, sc, rot: rotIdx.get(s.id) ?? 0 }
  })

  scored.sort((a, b) => b.sc - a.sc || a.rot - b.rot)

  // 难度均衡：同一 level 最多连出 2 句，避免一次三句全是问句
  const picked: SentBankItem[] = []
  const lvCount: Record<string, number> = {}
  for (const it of scored) {
    if (picked.length >= opts.count) break
    const c = lvCount[it.s.level] || 0
    if (c >= 2 && opts.count > 3) continue
    picked.push(it.s)
    lvCount[it.s.level] = c + 1
  }
  // 均衡卡住了数量就放宽，宁可连着同档也不要少出题
  for (const it of scored) {
    if (picked.length >= opts.count) break
    if (picked.includes(it.s)) continue
    picked.push(it.s)
  }
  return picked.slice(0, opts.count)
}

/**
 * 给句子配干扰项（句意选择用）。
 *
 * 干扰项必须「看着像那么回事」，随机抓三句中文，孩子一眼就能排除，等于没考。
 * 三层过滤：
 *  1. 句式要一致 —— 题干是陈述句，选项里混一个「……为什么要称赞这件衣服？」，
 *     孩子不用读懂英文，看问号就知道不该选（实测第一批就出现了这个）
 *  2. 长度要接近 —— 四个字 vs 三十个字，长短本身就是提示
 *  3. 同单元优先，其次同语法特征
 */
export function cnDistractors(target: SentBankItem, unit: string, n = 3): string[] {
  const u = getSentUnit(unit)
  const all = (u ? u.sents : allSents()).filter(s => s.id !== target.id && s.cn !== target.cn)
  const tq = target.level === 'S2'

  const sameForm = all.filter(s => (s.level === 'S2') === tq)
  const lenOK = sameForm.filter(s => Math.abs(s.cn.length - target.cn.length) <= 12)
  const pool = lenOK.length >= n ? lenOK : (sameForm.length >= n ? sameForm : all)

  const near = pool.filter(s => s.level === target.level || s.gram.some(g => target.gram.includes(g)))
  const far = pool.filter(s => !near.includes(s))
  const order = [...seededShuffle(near, 'dis|' + target.id), ...seededShuffle(far, 'far|' + target.id)]

  const out: string[] = []
  for (const s of order) {
    if (out.length >= n) break
    if (out.includes(s.cn)) continue
    out.push(s.cn)
  }
  return out
}

/** 今天的句子批次种子（战报、续做都用它） */
export function sentSeedOf(dayKey: string, profileId: string, unit: string): string {
  return `sent|${dayKey}|${profileId}|${unit}`
}

/** 该单元还有没有句子可用（首页入口判断） */
export function hasSentBank(unit: string): boolean {
  const u = getSentUnit(unit)
  return !!u && u.sents.length > 0
}

/** 句子 id 是否合法（防御后台传脏数据） */
export function isSentId(id: string): boolean {
  return allSents().some(s => s.id === id)
}

/** 今天的日期（用于日序轮转的默认值） */
export function todayKey(): string {
  return bjDayKey()
}

/** 供单测：把某条句子从库里查出来 */
export function sentById(id: string): SentBankItem | null {
  return allSents().find(s => s.id === id) || null
}

/** 供单测：种子散列，暴露出来便于验证「同输入同输出」 */
export { hashSeed }
