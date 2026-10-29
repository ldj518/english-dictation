/**
 * 课文（教材语篇）数据层。
 *
 * 数据来源：课本配套录音的文字稿 + 逐句时间轴（scripts 在 workspace/_textbook 下生成）。
 * 与听写模块的关系：这是「读」的素材，不是「考」的题面，所以英文可以明示。
 *
 * 词义分两级查：
 *  1. gloss.json（613 条，源自 Android 端 assets/gloss.json + 本单元补的 58 条）
 *  2. 查不到就返回 null，页面显示「暂无释义」，但仍可点读发音
 */
import unit04 from '../data/text/unit04.json'
import glossRaw from '../data/text/gloss.json'

export interface TextSent {
  no: number
  en: string
  cn: string
  ms0: number
  ms1: number
  para: number
}

export interface TextStory {
  id: string
  title: string
  titleCn: string
  section: string
  paraCount: number
  sents: TextSent[]
}

export interface TextUnit {
  unit: string
  unitName: string
  unitNameCn: string
  stories: TextStory[]
}

const UNITS: Record<string, TextUnit> = {
  unit04: unit04 as unknown as TextUnit,
}

export function getTextUnit(unit: string): TextUnit | null {
  return UNITS[unit] || null
}

export function textUnitIds(): string[] {
  return Object.keys(UNITS)
}

const GLOSS: Record<string, string> = (glossRaw as unknown as { words?: Record<string, string> }).words || {}

/** 查一个词形的小写形式释义；查不到返回 null */
export function glossOf(lower: string): string | null {
  return GLOSS[lower] || null
}

export interface Token {
  /** 原样显示的文本（含大小写） */
  text: string
  /** 小写词形；标点/空格为 null */
  word: string | null
}

const WORD_RE = /[A-Za-z']+/g

/** 把一个句子切成「词 / 非词」片段，保留原有空格与标点 */
export function tokenize(en: string): Token[] {
  const out: Token[] = []
  let last = 0
  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(en)) !== null) {
    if (m.index > last) out.push({ text: en.slice(last, m.index), word: null })
    // 去掉首尾多余的撇号（'tis、dogs' 这类切出来会带引号）
    const raw = m[0]
    const trimmed = raw.replace(/^'+|'+$/g, '')
    if (trimmed) {
      const lead = raw.length - raw.replace(/^'+/, '').length
      if (lead > 0) out.push({ text: raw.slice(0, lead), word: null })
      out.push({ text: trimmed, word: trimmed.toLowerCase() })
      const trail = raw.length - lead - trimmed.length
      if (trail > 0) out.push({ text: raw.slice(lead + trimmed.length), word: null })
    } else {
      out.push({ text: raw, word: null })
    }
    last = m.index + raw.length
  }
  if (last < en.length) out.push({ text: en.slice(last), word: null })
  return out
}

/** 把同一段的句子按段落归组，供页面逐段渲染 */
export function groupParas(story: TextStory): TextSent[][] {
  const arr: TextSent[][] = Array.from({ length: story.paraCount }, () => [])
  for (const s of story.sents) {
    const idx = s.para >= 0 && s.para < arr.length ? s.para : arr.length - 1
    if (idx >= 0) arr[idx].push(s)
  }
  return arr
}

/** 一篇里出现过的所有词形（小写去重，按首次出现顺序） */
export function storyWords(story: TextStory): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of story.sents) {
    for (const tk of tokenize(s.en)) {
      if (tk.word && !seen.has(tk.word)) {
        seen.add(tk.word)
        out.push(tk.word)
      }
    }
  }
  return out
}
