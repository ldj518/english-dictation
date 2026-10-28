/**
 * 题库生成器（v4 P3）。
 *
 * 把 buildPlan 出来的「段骨架」填成一道道具体的题。
 * 纯数据层：不碰 React，不碰音频，不碰存储（除了进入计数）。
 *
 * 防泄题约束（沿用你定的老规矩，一条不破）：
 *  - 听写屏绝不渲染英文答案（拼写题只给中文 + 首字母 + 词长）
 *  - 中文提示必须点击才出（选义题不预置中文）
 *  - 一屏一种信息形态，中英文不混排
 *  - 句子段必须在拼写关之后（先认词，再进句子）
 */

import type { DayPlan, SegKind } from './plan'
import { WORDS, WORD_MAP } from './data'
import { seededShuffle, makeSeed } from './shuffle'
import { bjDayKey } from './bj'
import sentencesJson from '../data/sentences.json'

export type QKind =
  | 'flash'   // 听音看词：只播音频 + 显示单词，点「记住了」
  | 'teach'   // 教学卡：音 → 形 → 义 → 音节，必须点「记住了」
  | 'pick'    // 听音选义：6 选 1，两步确认
  | 'spell'   // 中文 + 首字母 → 输入英文
  | 'sent'    // 句子拼装：中文 + 乱序词块
  | 'paper'   // 纸笔：显示中文，纸上写，之后自评

export interface Option {
  key: string
  text: string
}

export interface Q {
  id: string
  kind: QKind
  /** 所属段下标（对应 DayPlan.segs 的 index） */
  seg: number
  /** 段种类（用于统计/战报） */
  segKind: SegKind
  word: string
  cn: string
  file: string | null
  /** 是否计入分数（热身/教学不计） */
  scored: boolean
  /** 是否算「必做」（决定时间够不够之后的第二道闸门） */
  must: boolean
  /* pick 专用 */
  options?: Option[]
  answerKey?: string
  /* spell 专用 */
  hint?: string
  /** 词长（含空格，短语按空格算） */
  len?: number
  /* sent 专用 */
  en?: string
  /** 正确词序 */
  tokens?: string[]
  /** 展示顺序（打乱后的 tokens 下标）。不打乱就是白送分——实测原样按正确顺序排出 */
  order?: number[]
  tip?: string
}

export interface QBank {
  dayKey: string
  qs: Q[]
  /** 每题在 segs 里的下标 → 该段第一题的全局下标 */
  segStart: number[]
}

export interface Sentence { en: string; cn: string; tip: string }
export const SENTENCES = sentencesJson as unknown as Record<string, Sentence>

/** 词的中文释义（cnFull 优先，带词性） */
export function cnOf(word: string): string {
  return WORD_MAP[word]?.cnFull || WORD_MAP[word]?.cn || ''
}

/** 词所属单元；unit 字段为空的 154 个词归 extra（不编造归属，也照常学） */
export function unitOf(word: string): string {
  return WORD_MAP[word]?.unit || 'extra'
}

/**
 * 进入计数（防「退出重进换题序」）。
 *
 * 坑在前：种子若用结算次数，孩子做两题退出重进，结算次数没变 → 题序一模一样，
 * 等于给了「按位置背答案」的通道。用进入次数就不会。
 */
function bumpEnter(dayKey: string): number {
  const key = `eng-dict-enter:${bjDayKey()}`
  let n = 0
  try {
    n = Number(sessionStorage.getItem(key) || 0) + 1
    sessionStorage.setItem(key, String(n))
  } catch { n = 1 }
  return n
}

/** 英文句子 → 词块（保留标点，连字符不拆） */
export function splitTokens(en: string): string[] {
  return en.trim().split(/\s+/).filter(Boolean)
}

/** 句子判分：拼出来的词块序列与正确序列一致（归一化大小写/标点） */
export function judgeSentence(picked: string[], answer: string[]): boolean {
  const norm = (a: string[]) => a.join(' ').toLowerCase().replace(/\s+/g, ' ').trim()
  const strip = (s: string) => s.replace(/[.,!?;:'"]/g, '')
  return strip(norm(picked)) === strip(norm(answer))
}

/** 拼写提示：首字母 + 词长（短语按每段首字母） */
export function spellHint(word: string): { hint: string; len: number } {
  const parts = word.split(' ')
  const hint = parts.map(p => p[0] + '·'.repeat(Math.max(0, p.length - 1))).join(' ')
  return { hint, len: word.replace(/ /g, '').length }
}

/* ── 生成题目 ─────────────────────────────────────── */

export interface BuildOpts {
  plan: DayPlan
  /** 今天该练的到期词（已按风险排好序） */
  dueWords: { word: string; cn: string }[]
  /** 新词（还没学过的） */
  newWords: { word: string; cn: string }[]
  /** 钉子词优先插入变式重复 */
  nailWords?: { word: string; cn: string }[]
  /** 音频文件映射 */
  fileMap: Map<string, string>
  /** 家庭身份 id（种子用） */
  profileId: string
  /** 今日第几次进入（不传则自动计数） */
  enter?: number
}

/** 造干扰选项：同单元优先，不够再全库补，保证 4 个不同释义 */
export function makeOptions(word: string, seed: string): { options: Option[]; answerKey: string } {
  const right = cnOf(word) || '（无释义）'
  const unit = unitOf(word)
  const sameUnit = WORDS.filter(w => w.word !== word && unitOf(w.word) === unit && (w.cnFull || w.cn))
    .map(w => w.cnFull || w.cn)
  const others = WORDS.filter(w => w.word !== word && (w.cnFull || w.cn)).map(w => w.cnFull || w.cn)
  const pool = Array.from(new Set([...sameUnit, ...others])).filter(t => t && t !== right)
  const picks = seededShuffle(pool, seed).slice(0, 5)
  const all = seededShuffle([right, ...picks], seed + '|shuf').map((text, i) => ({ key: 'k' + i, text }))
  return { options: all, answerKey: all.find(o => o.text === right)!.key }
}

/**
 * 生成今日题池。
 * 同一天、同一身份、同一次进入 → 完全一样（刷新不换题）；
 * 退出重进 → 进入计数 +1，题序变（防按位置背）。
 */
export function buildQBank(opts: BuildOpts): QBank {
  const { plan } = opts
  const day = plan.dayKey
  const enter = opts.enter ?? bumpEnter(day)
  const seedBase = `${day}|${opts.profileId}|${plan.tier}|e${enter}`
  const fileOf = (w: string) => opts.fileMap.get(w) || null
  const cn = cnOf

  // 到期词池：先按段需要切块，不够再从头借（同一批词换题型复用，不算注水）
  const due = opts.dueWords.slice()
  const nail = (opts.nailWords || []).slice()
  const fresh = opts.newWords.slice()

  let dueCursor = 0
  const takeDue = (n: number): { word: string; cn: string }[] => {
    const out: { word: string; cn: string }[] = []
    for (let i = 0; i < n && due.length; i++) {
      out.push(due[dueCursor % due.length])
      dueCursor++
      if (dueCursor > due.length * 3) break   // 池子太小，别无限循环
    }
    return out
  }

  const qs: Q[] = []
  const segStart: number[] = []
  let n = 0

  plan.segs.forEach((s, si) => {
    segStart[si] = qs.length
    const push = (q: Omit<Q, 'id' | 'seg' | 'segKind'>) => {
      qs.push({ ...q, id: `q${n}`, seg: si, segKind: s.k } as Q)
      n++
    }

    switch (s.k) {
      case 'warm': {
        // 热身：只做听音看词、不判分，并且**故意取 review 段要考的头几个词**——
        // 先看一眼再考，比考完再看有效（这才是热身的意义，不是另找几个词做题）
        for (const w of due.slice(0, Math.min(3, s.words))) {
          push({ kind: 'flash', word: w.word, cn: cn(w.word), file: fileOf(w.word), scored: false, must: false })
        }
        break
      }
      case 'learn': {
        // 教学卡：音 → 形 → 义 → 音节，必须点「记住了」
        const pool = fresh.length ? fresh : takeDue(s.words)
        for (const w of pool.slice(0, s.words)) {
          push({ kind: 'teach', word: w.word, cn: cn(w.word), file: fileOf(w.word), scored: false, must: false })
        }
        break
      }
      case 'review':
      case 'recall': {
        // 拼写判分。到了句段之前一定有拼写（方案里定的顺序）
        const pool = s.k === 'recall'
          ? (fresh.length ? fresh : takeDue(s.words))
          : takeDue(s.words)
        for (const w of pool.slice(0, s.words)) {
          const { hint, len } = spellHint(w.word)
          push({
            kind: 'spell', word: w.word, cn: cn(w.word), file: fileOf(w.word),
            scored: true, must: true, hint, len,
          })
        }
        break
      }
      case 'choice':
      case 'test': {
        const pool = takeDue(s.words)
        pool.forEach((w, i) => {
          const { options, answerKey } = makeOptions(w.word, `${seedBase}|pick|${si}|${i}`)
          push({
            kind: 'pick', word: w.word, cn: cn(w.word), file: fileOf(w.word),
            scored: true, must: true, options, answerKey,
          })
        })
        break
      }
      case 'spell': {
        for (const w of takeDue(s.words)) {
          const { hint, len } = spellHint(w.word)
          push({
            kind: 'spell', word: w.word, cn: cn(w.word), file: fileOf(w.word),
            scored: true, must: true, hint, len,
          })
        }
        break
      }
      case 'drill': {
        // 变式重复：钉子词优先，换题型（对 pick 换成拼写，对拼写换成选义）
        const src = nail.length ? nail : takeDue(Math.max(2, Math.ceil(s.words || s.q / 2)))
        for (let i = 0; i < s.q; i++) {
          const w = src[i % src.length]
          if (!w) break
          const alt = i % 2 === 0
          if (alt) {
            const { hint, len } = spellHint(w.word)
            push({
              kind: 'spell', word: w.word, cn: cn(w.word), file: fileOf(w.word),
              scored: true, must: false, hint, len,
            })
          } else {
            const { options, answerKey } = makeOptions(w.word, `${seedBase}|drill|${si}|${i}`)
            push({
              kind: 'pick', word: w.word, cn: cn(w.word), file: fileOf(w.word),
              scored: true, must: false, options, answerKey,
            })
          }
        }
        break
      }
      case 'paper': {
        // 纸笔：屏幕只给中文，纸上写；写完自评（家长可查照片）
        for (const w of takeDue(s.words)) {
          push({
            kind: 'paper', word: w.word, cn: cn(w.word), file: fileOf(w.word),
            scored: true, must: true,
          })
        }
        break
      }
      case 'sent': {
        const pool = takeDue(Math.max(s.words, 2))
        const usable = pool.filter(w => SENTENCES[w.word]?.en)
        const list = usable.length ? usable : pool
        for (const w of list.slice(0, s.words)) {
          const sen = SENTENCES[w.word]
          if (!sen) continue
          const tokens = splitTokens(sen.en)
          const idx = tokens.map((_, i) => i)
          // 打乱到「至少 3 处错位」，否则 4 个词的短句有概率洗出原序
          let order = seededShuffle(idx, `${seedBase}|sent|${si}|${w.word}`)
          for (let k = 0; k < 6 && order.filter((v, i) => v === i).length > tokens.length - 3; k++) {
            order = seededShuffle(order, `${seedBase}|sent|${si}|${w.word}|${k}`)
          }
          push({
            kind: 'sent', word: w.word, cn: sen.cn, file: fileOf(w.word),
            scored: true, must: true, en: sen.en, tokens, order, tip: sen.tip,
          })
        }
        break
      }
      case 'wrap':
      default:
        break
    }
  })

  return { dayKey: day, qs, segStart }
}

/**
 * 追加变式重复题（时间不够 30 分钟时补缺口）。
 *
 * 关键约束：**同词必须换题型**。同一个词出两遍一样的拼写题叫注水，
 * 出「拼写 → 选义」才叫换个通道记。所以按 i 的奇偶交替。
 *
 * @param words 优先用今天做错的词（它们最该再碰）
 */
export function extraDrill(
  words: { word: string; cn: string }[],
  count: number,
  fileMap: Map<string, string>,
  seed: string,
  startId = 0
): Q[] {
  const out: Q[] = []
  if (!words.length) return out
  for (let i = 0; i < count; i++) {
    const w = words[i % words.length]
    const alt = i % 2 === 0
    if (alt) {
      const { hint, len } = spellHint(w.word)
      out.push({
        id: 'x' + (startId + i), kind: 'spell', seg: -1, segKind: 'drill',
        word: w.word, cn: cnOf(w.word) || w.cn, file: fileMap.get(w.word) || null,
        scored: true, must: false, hint, len,
      })
    } else {
      const { options, answerKey } = makeOptions(w.word, `${seed}|x|${i}`)
      out.push({
        id: 'x' + (startId + i), kind: 'pick', seg: -1, segKind: 'drill',
        word: w.word, cn: cnOf(w.word) || w.cn, file: fileMap.get(w.word) || null,
        scored: true, must: false, options, answerKey,
      })
    }
  }
  return out
}

/** 必做题总数（第二道闸门的分母） */
export function mustCount(qs: Q[]): number {
  return qs.filter(q => q.must).length
}

/** 某段的题号范围 [from, to) */
export function segRange(bank: QBank, si: number): [number, number] {
  const from = bank.segStart[si] ?? 0
  const to = bank.segStart[si + 1] ?? bank.qs.length
  return [from, to]
}
