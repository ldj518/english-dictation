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
import { pickSents, cnDistractors, getSentUnit, sentUnitIds, type SentBankItem } from './sentbank'
import sentencesJson from '../data/sentences.json'

export type QKind =
  | 'flash'   // 听音看词：只播音频 + 显示单词，点「记住了」
  | 'teach'   // 教学卡：音 → 形 → 义 → 音节，必须点「记住了」
  | 'pick'    // 听音选义：6 选 1，两步确认
  | 'spell'   // 中文 + 首字母 → 输入英文
  | 'sent'    // 句子拼装：中文 + 乱序意群块
  | 'mean'    // 句意选择：整句英文 + 4 个中文句意
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
  /** 正确词序（单词块或意群块） */
  tokens?: string[]
  /** 展示顺序（打乱后的 tokens 下标）。不打乱就是白送分——实测原样按正确顺序排出 */
  order?: number[]
  /** 意群块（句子关用；有它就按块拼，没有就按 tokens 逐词拼） */
  blocks?: string[]
  /* sent / mean 共用：句子库 id，用于当天去重和战报追溯 */
  sentId?: string
  /** 句型分级 S1-S5（战报按档统计用） */
  sentLevel?: string
  /* mean 专用：中文句意选项 */
  cnOptions?: Option[]
  cnKey?: string
  tip?: string
}

export interface QBank {
  dayKey: string
  qs: Q[]
  /** 每题在 segs 里的下标 → 该段第一题的全局下标 */
  segStart: number[]
  /**
   * 本次用的进入计数。断点续做要拿它重建同一份题库——
   * 重进时若不传回这个数，bumpEnter 会 +1，题目顺序全变，接着做就接不上了。
   */
  enter: number
  /**
   * 今天出过的句子 id（sent / mean 两段合计）。
   * 结算时写进 dayLog.sentIds，明天抽句时作为 recent 传给 pickSents，
   * 这就是跨天去重的载体——不落下来，「别重复」无从谈起。
   */
  sentIds: string[]
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

/**
 * 句子判分：拼出来的块序列与正确序列一致。
 *
 * 只去句末和词间标点，**撇号必须保留**。原来把 `:'"` 一起 strip 掉，
 * `its` 和 `it's` 会被判成同一个词——课本句里 don't / it's / Ben's 到处都是，
 * 这会变成一种系统性错判（少打一个撇号照样算对）。
 * 弯引号和直引号统一成直引号再比，否则孩子手机输入法一换就判错。
 */
export function judgeSentence(picked: string[], answer: string[]): boolean {
  const norm = (a: string[]) => a.join(' ')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  const strip = (s: string) => s.replace(/[.,!?;:"]/g, '')
  return strip(norm(picked)) === strip(norm(answer))
}

/** 拼写提示：首字母 + 词长（短语按每段首字母） */
export function spellHint(word: string): { hint: string; len: number } {
  const parts = word.split(' ')
  const hint = parts.map(p => p[0] + '·'.repeat(Math.max(0, p.length - 1))).join(' ')
  return { hint, len: word.replace(/ /g, '').length }
}

/* ── 生成题目 ─────────────────────────────────────── */

export interface WordItem {
  word: string
  cn: string
  /**
   * 记忆强度 S。不传 = 未知，按「能拼」处理（老调用点与单测保持原行为）。
   * 传了才做拼写分级，见 canSpell。
   */
  S?: number
}

export interface BuildOpts {
  plan: DayPlan
  /** 当前在学单元（句子关从该单元的句子库取句；不传则按到期词所在单元推断） */
  unit?: string
  /** 今天该练的到期词（已按风险排好序） */
  dueWords: WordItem[]
  /** 新词（还没学过的） */
  newWords: WordItem[]
  /** 钉子词优先插入变式重复 */
  nailWords?: WordItem[]
  /** 音频文件映射 */
  fileMap: Map<string, string>
  /** 家庭身份 id（种子用） */
  profileId: string
  /** 今日第几次进入（不传则自动计数） */
  enter?: number
  /**
   * 近几天做过的句子 id（跨天去重）。
   *
   * 一个单元只有 23–34 句，每天出 3–5 句，5–8 天就见底。原来只在同一批内去重，
   * 跨天零记录，结果第二周孩子做的全是上周原句，家长看到的句子关正确率是假的。
   * 这里不硬排除（库里句数有限），只是让 pickSents 把它们排到队尾。
   */
  recentSents?: string[]
}

/**
 * 这个词今天能不能考拼写。
 *
 * 病根在 p1 的实账：到期 127 个词里 122 个 S=1（等于没会），而旧流水线
 * 天天拿拼写去考这 122 个词——拼不出来 → 答错 → S 归 1 → 明天再拼 → 再错。
 * 死循环跑三周，S=1 的词一个没少。
 *
 * 正确路径是把「认」和「写」分开：S < 4 的词先只用听音选义把它抬上去
 * （答对一次 S×2，两三次就到 4），S ≥ 4 才配拼写题。
 * 这不是放水——拼写题在卷面上照样扣分，只是不该拿它当唯一手段。
 */
export function canSpell(w: WordItem): boolean {
  if (typeof w.S !== 'number') return true
  return w.S >= 4
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
 * 打乱顺序，并要求「至少 3 处错位」。
 * 不打乱到这一步，4 个词的短句有概率洗出原序，等于白送分（实测发生过）。
 */
export function scrambleOrder(n: number, seed: string): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  if (n <= 2) return seededShuffle(idx, seed)
  let order = seededShuffle(idx, seed)
  for (let k = 0; k < 8 && order.filter((v, i) => v === i).length > n - 3; k++) {
    order = seededShuffle(order, `${seed}|r${k}`)
  }
  return order
}

/** 当前句子关用哪个单元：显式指定 > 今天在学的词多数所在单元 > 第一个有句库的单元 */
function unitOfSent(opts: BuildOpts): string {
  if (opts.unit) return opts.unit
  // 新词权重更高：新词所在单元就是课本正在讲的单元。
  // 学生跨单元复习时到期词会分散，按众数取才不会被一两句旧单元的句子带偏。
  const cnt: Record<string, number> = {}
  for (const w of opts.newWords) {
    const u = unitOf(w.word)
    if (u && getSentUnit(u)) cnt[u] = (cnt[u] || 0) + 3
  }
  for (const w of opts.dueWords) {
    const u = unitOf(w.word)
    if (u && getSentUnit(u)) cnt[u] = (cnt[u] || 0) + 1
  }
  const best = Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (best) return best[0]
  return sentUnitIds()[0] || 'unit04'
}

/**
 * 句子的「锚词」——这一句是为了练哪个词。
 * 优先级与选句一致：新词 > 钉子词 > 到期词 > 句中第一个词表词。
 * 锚词决定这句答对后算给谁（记忆打分只沿用词级口径，句子本身不单独建状态）。
 */
function anchorOf(it: SentBankItem, opts: BuildOpts): string {
  const news = opts.newWords.map(x => x.word.toLowerCase())
  const nails = (opts.nailWords || []).map(x => x.word.toLowerCase())
  const dues = opts.dueWords.map(x => x.word.toLowerCase())
  const lw = it.words.map(w => w.toLowerCase())
  for (const pool of [news, nails, dues]) {
    const hit = lw.find(w => pool.includes(w))
    if (hit) return it.words.find(w => w.toLowerCase() === hit) || hit
  }
  return it.words[0] || ''
}

/** 从句子库挑一批句子；库空或全用过了就返回空数组（调用方退回老路径） */
function pickSentenceBatch(
  opts: BuildOpts, si: number, seedBase: string, count: number, use: 'block' | 'mean', used: string[]
): SentBankItem[] {
  if (count <= 0) return []
  const unit = unitOfSent(opts)
  if (!getSentUnit(unit)) return []
  return pickSents({
    unit,
    dayKey: opts.plan.dayKey,
    profileId: `${opts.profileId}|${seedBase}|${si}`,
    newWords: opts.newWords.map(w => w.word),
    nailWords: (opts.nailWords || []).map(w => w.word),
    dueWords: opts.dueWords.map(w => w.word),
    count,
    use,
    used,
    recent: opts.recentSents,
  })
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
  const takeDue = (n: number): WordItem[] => {
    const out: WordItem[] = []
    for (let i = 0; i < n && due.length; i++) {
      out.push(due[dueCursor % due.length])
      dueCursor++
      if (dueCursor > due.length * 3) break   // 池子太小，别无限循环
    }
    return out
  }

  const qs: Q[] = []
  const segStart: number[] = []
  /** 当天已经出过的句子 id：同一天两批句子关不能出同一句 */
  const usedSents: string[] = []
  /** 本关教过的词。重启档要让后面的拼写考「刚教过的」，不能教一批考另一批 */
  let taught: WordItem[] = []
  /** taught 只给紧跟着的那一段用一次。分享给后面所有 review 会把「清到期 23 题」
   *  压成 12 题（线上实测总题数 45 → 34、必做 33 → 22） */
  let taughtUsed = false
  let n = 0

  plan.segs.forEach((s, si) => {
    segStart[si] = qs.length
    const push = (q: Omit<Q, 'id' | 'seg' | 'segKind'>) => {
      qs.push({ ...q, id: `q${n}`, seg: si, segKind: s.k } as Q)
      n++
    }

    /** 拼写题：屏幕只给中文 + 首字母 + 空格数，绝不出现整词 */
    const pushSpell = (w: WordItem) => {
      const { hint, len } = spellHint(w.word)
      push({
        kind: 'spell', word: w.word, cn: cn(w.word), file: fileOf(w.word),
        scored: true, must: true, hint, len,
      })
    }
    /** 听音选义（两步确认） */
    const pushPickOf = (w: WordItem, i: number, tag: string) => {
      const { options, answerKey } = makeOptions(w.word, `${seedBase}|${tag}|${si}|${i}`)
      push({
        kind: 'pick', word: w.word, cn: cn(w.word), file: fileOf(w.word),
        scored: true, must: true, options, answerKey,
      })
    }
    /**
     * 按记忆强度分流（见 canSpell）：
     * 拼写位只留三分之一，优先给 S 最高的词（最容易拼对的），其余出听音选义。
     *
     * 这个比例不是拍脑袋：p1 到期池里 122/127 是 S=1，全出拼写孩子一道都拼不出，
     * S 永远归 1；全出选义又一道不写，到了卷面还是提笔忘字。三分之一是他
     * 「能拼对的刚好占三分之一」这个实账倒推的。
     */
    const pushGraded = (items: WordItem[], tag: string) => {
      const slots = Math.max(3, Math.ceil(items.length / 3))
      const spellSet = new Set(
        items.filter(canSpell).sort((a, b) => (b.S || 0) - (a.S || 0)).slice(0, slots).map(w => w.word)
      )
      items.forEach((w, i) => {
        if (spellSet.has(w.word)) pushSpell(w)
        else pushPickOf(w, i, tag)
      })
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
        taught = pool.slice(0, s.words)
        for (const w of taught) {
          push({ kind: 'teach', word: w.word, cn: cn(w.word), file: fileOf(w.word), scored: false, must: false })
        }
        break
      }
      case 'review':
      case 'recall': {
        // 拼写判分。到了句段之前一定有拼写（方案里定的顺序）
        // 重启档紧接着教学卡：考刚教过的那批（教 12 考 8），教考分离会让孩子
        // 在「重学」当天先看 12 张脸生的卡、再拼 8 个没讲过的词，等于白教。
        // 只在第一段 review 生效：taughtUsed 之后回到正常取词，
        // 否则「继续清到期 +23 词」会退化成再考一遍那 12 个词。
        const reuse = plan.tier === 'restart' && taught.length > 0 && !taughtUsed
        const pool = s.k === 'recall'
          ? (fresh.length ? fresh : takeDue(s.words))
          : (reuse ? taught.slice(0, s.words) : takeDue(s.words))
        if (reuse) taughtUsed = true
        const items = pool.slice(0, s.words)
        /**
         * 刚教过的词（recall）和重启档的重学段照旧全拼——教完立刻写是设计意图，
         * 那一批的 S 天生是 0，按分级走的话一节新课一个词都拼不出来。
         * 段太短（≤4 题）也全拼，否则孩子一整顿都碰不到拼写。
         */
        if (s.k === 'recall' || reuse || items.length <= 4) items.forEach(pushSpell)
        else pushGraded(items, 'rv')
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
        // 拼写巩固：同样按 S 分流，不是每道都逼默写
        const items = takeDue(s.words)
        if (items.length <= 4) items.forEach(pushSpell)
        else pushGraded(items, 'sp')
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
        // 句子关：从课文句子库取句，按「含新词 > 钉子词 > 到期词」挑。
        // 挑不到（该单元没有句子库）就退回老的单词拼装，不让这一关空着。
        const picked = pickSentenceBatch(opts, si, seedBase, s.words, 'block', usedSents)
        if (!picked.length) {
          const pool = takeDue(Math.max(s.words, 2))
          const usable = pool.filter(w => SENTENCES[w.word]?.en)
          const list = usable.length ? usable : pool
          for (const w of list.slice(0, s.words)) {
            const sen = SENTENCES[w.word]
            if (!sen) continue
            const tokens = splitTokens(sen.en)
            push({
              kind: 'sent', word: w.word, cn: sen.cn, file: fileOf(w.word),
              scored: true, must: true, en: sen.en, tokens,
              order: scrambleOrder(tokens.length, `${seedBase}|sent|${si}|${w.word}`),
              tip: sen.tip,
            })
          }
          break
        }
        for (const it of picked) {
          usedSents.push(it.id)
          push({
            kind: 'sent',
            word: anchorOf(it, opts),
            cn: it.cn,
            file: null,
            scored: true,
            must: true,
            en: it.en,
            blocks: it.blocks,
            sentId: it.id,
            sentLevel: it.level,
            order: scrambleOrder(it.blocks.length, `${seedBase}|sent|${si}|${it.id}`),
            tip: it.level === 'S2' ? '问句：助动词提到主语前面' : undefined,
          })
        }
        break
      }
      case 'mean': {
        // 句意选择：整句英文 + 4 个中文句意。
        // ⚠️ 这一关必须排在拼写之后（plan.ts 保证），否则整句英文里的词就是答案
        const picked = pickSentenceBatch(opts, si, seedBase, s.words, 'mean', usedSents)
        for (let i = 0; i < picked.length; i++) {
          const it = picked[i]
          usedSents.push(it.id)
          const distract = cnDistractors(it, unitOfSent(opts), 3)
          const all = seededShuffle([it.cn, ...distract], `${seedBase}|mean|${si}|${it.id}`)
            .map((text, k) => ({ key: 'm' + k, text }))
          push({
            kind: 'mean',
            word: anchorOf(it, opts),
            cn: it.cn,
            file: fileOf(anchorOf(it, opts)),
            scored: true,
            must: false,
            en: it.en,
            sentId: it.id,
            sentLevel: it.level,
            cnOptions: all,
            cnKey: all.find(o => o.text === it.cn)!.key,
          })
        }
        break
      }
      case 'wrap':
      default:
        break
    }
  })

  return { dayKey: day, qs, segStart, enter, sentIds: usedSents }
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
