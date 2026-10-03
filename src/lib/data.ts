import type { Track, Word, AudioItem, ItemTuple } from '../types'
import { audioUrl } from './assets'
import wordsJson from '../data/words.json'
import tasksJson from '../data/tasks.json'

export const WORDS = wordsJson as unknown as Word[]

/** 原始任务（items 为元组） */
const RAW_TASKS = tasksJson as unknown as Track[]

export const WORD_MAP: Record<string, Word> = Object.fromEntries(
  WORDS.map(w => [w.word, w])
)

/** 音频清单：trackId -> AudioItem[]（从 public/audio/manifest.json 加载，带逐词音频文件名） */
let _audioIndex: Record<string, AudioItem[]> | null = null
let _audioLoading: Promise<Record<string, AudioItem[]>> | null = null

export async function loadAudioIndex(): Promise<Record<string, AudioItem[]>> {
  if (_audioIndex) return _audioIndex
  if (_audioLoading) return _audioLoading
  _audioLoading = (async () => {
    try {
      // 按天换 query 破缓存：旧 manifest 曾以 immutable 缓存在浏览器/边缘一年，
      // 不换 URL 永远拿不到指向新音频文件的清单（v2.5 去报号版踩过）
      const d = new Date()
      const z = (x: number) => String(x).padStart(2, '0')
      const v = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`
      const r = await fetch(audioUrl(`manifest.json?v=${v}`))
      const m = await r.json()
      const idx: Record<string, AudioItem[]> = {}
      for (const t of m.tracks as { id: string; items: AudioItem[] }[]) {
        idx[t.id] = t.items
      }
      _audioIndex = idx
      return idx
    } catch {
      // 加载失败：返回空，页面回退到 Web Speech
      _audioIndex = {}
      return {}
    }
  })()
  return _audioLoading
}

/** 把元组转成 AudioItem（无音频文件时 file=null，播放走 Web Speech） */
export function tuplesToItems(items: ItemTuple[]): AudioItem[] {
  return items.map(([no, word, cn]) => ({ no, word, cn, file: null }))
}

export function tasksByGroup(g: Track['group']): Track[] {
  return RAW_TASKS.filter(t => t.group === g).sort((a, b) => a.order - b.order)
}

export function getTrack(id: string): Track | undefined {
  return RAW_TASKS.find(t => t.id === id)
}

export const ALL_TASKS = RAW_TASKS
export const DAILY = tasksByGroup('daily')
export const UNITS = tasksByGroup('unit')
export const FINALS = tasksByGroup('final')

/** 单元归属：unit01..07 的词表（items 是元组，word 在索引 1） */
export const UNIT_WORDS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const t of UNITS) {
    m[t.id] = Array.from(new Set(t.items.map(i => i[1])))
  }
  return m
})()

/* ── 单词 → 真人音频文件（点读用）────────────────────────── */

let _wordFiles: Map<string, string> | null = null

/**
 * 全词库的 word → file 映射（扫一遍音频清单，同词取第一个命中的文件）。
 * 错词本/词库/结果页的「点喇叭读真音」都靠它——
 * 以前这些地方用 Web Speech 兜底，就是用户投诉的「机械杂音」。
 */
export async function wordFileMap(): Promise<Map<string, string>> {
  if (_wordFiles) return _wordFiles
  const idx = await loadAudioIndex()
  if (!_wordFiles) {
    const m = new Map<string, string>()
    for (const items of Object.values(idx)) {
      for (const it of items) {
        if (it.file && !m.has(it.word)) m.set(it.word, it.file)
      }
    }
    _wordFiles = m
  }
  return _wordFiles
}

/**
 * 按单词文本播放真人音频（有文件用文件，没有回退 Web Speech）。
 * 供没有 track 上下文的页面使用（错词本、词库、结果页点读）。
 */
export async function playWordText(word: string, rate = 1): Promise<void> {
  const { playWord, speakWord } = await import('./player')
  const map = await wordFileMap()
  const file = map.get(word)
  if (file) {
    await playWord({ no: 0, word, cn: '', file }, rate)
  } else {
    speakWord(word, rate)
  }
}

/** 按单元分组的词条（用于词库浏览） */
export const WORDS_BY_UNIT = (() => {
  const m: Record<string, Word[]> = {}
  for (const w of WORDS) {
    const k = w.unit || 'other'
    ;(m[k] ||= []).push(w)
  }
  return m
})()

/** 第 N 天对应的单元（用于首页提示「今天在学哪个单元」） */
export function unitOfDay(dayOrder: number): number {
  // 7 单元 / 36 天，约每 5 天一个单元
  return Math.min(7, Math.max(1, Math.ceil(dayOrder / 5)))
}

/* ═══════════ 词库册子 + 动态任务（v2.5）═══════════ */

import { load, activeProfileId, dueWrongWords } from './storage'
import { dueReviews } from './reviewQueue'
import { seededShuffle, makeSeed, orderSalt, orderEpoch } from './shuffle'
import { currentShuffleMode, currentSalt, currentBooks } from './api'

export interface BookWord { word: string; cn: string; file: string | null }
export interface LoadedBook { id: string; name: string; words: BookWord[]; byKey: Map<string, BookWord> }

/** 内置七上：按任务顺序收集全部词条（去重） */
function builtinWords(): { word: string; cn: string }[] {
  const seen = new Set<string>()
  const out: { word: string; cn: string }[] = []
  for (const t of RAW_TASKS) {
    for (const it of t.items) {
      const key = it[1].toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ word: it[1], cn: it[2] })
    }
  }
  return out
}

/**
 * 加载当前激活册子的全量词表（带逐词音频 file，没有音频的词为 null → 前端
 * 自动回退 Web Speech）。内置册子来自 tasks.json，自定义册子来自 D1 词单
 * （同名词自动继承内置词的音频）。
 */
export async function loadBookWords(): Promise<LoadedBook> {
  const b = currentBooks()
  const activeId = b?.active || 'builtin7a'
  const activeMeta = b?.books.find(x => x.id === activeId)

  let raw: { word: string; cn: string }[]
  if (activeId !== 'builtin7a' && activeMeta) {
    raw = await fetchBookWords(activeId)
  } else {
    raw = builtinWords()
  }

  const fmap = await wordFileMap()
  const words: BookWord[] = raw.map(w => ({ ...w, file: fmap.get(w.word) || null }))
  const byKey = new Map<string, BookWord>()
  for (const w of words) byKey.set(w.word.toLowerCase(), w)
  return { id: activeId, name: activeMeta?.name || '鲁教版七上（内置）', words, byKey }
}

/** 拉自定义册子的词单明细（/api/wordbook-words?id=xx），失败回退内置 */
async function fetchBookWords(id: string): Promise<{ word: string; cn: string }[]> {
  try {
    const r = await fetch('/api/wordbook-words?id=' + encodeURIComponent(id))
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json() as { ok: boolean; words?: { word: string; cn: string }[] }
    if (j.ok && Array.isArray(j.words) && j.words.length >= 5) return j.words
  } catch { /* 离线/后端挂 → 回退内置词表，不能耽误学习 */ }
  return builtinWords()
}

/** 今日动态任务：每日计划（第 planDone+1 天，每天 N 个新词） */
export async function getPlanTrack(): Promise<{ track: Track; day: number; total: number; bookName: string }> {
  const book = await loadBookWords()
  const n = Math.max(3, currentBooks()?.dailyWords || 10)
  const p = load(activeProfileId())
  const total = Math.max(1, Math.ceil(book.words.length / n))
  const day = Math.max(1, Math.min(total, (p.planDone || 0) + 1))
  const slice = book.words.slice((day - 1) * n, day * n)
  const track: Track = {
    id: 'plan',
    kind: 'daily',
    group: 'daily',
    order: day,
    label: '每日计划 · 第 ' + day + '/' + total + ' 天',
    file: '',
    seconds: 0,
    wordCount: slice.length,
    sections: [],
    items: slice.map((w, i) => [i + 1, w.word, w.cn, 0, 0] as ItemTuple),
  }
  return { track, day, total, bookName: book.name }
}

/** 智能混合卷：已学过的词 ∪ 错词本词，随机抽一组（没学过的绝不出现） */
export async function getMixTrack(): Promise<{ track: Track; poolSize: number }> {
  const book = await loadBookWords()
  const n = Math.max(3, currentBooks()?.dailyWords || 10)
  const p = load(activeProfileId())
  const learned = book.words.slice(0, Math.min(book.words.length, (p.planDone || 0) * n))
  const pool = new Map<string, BookWord>()
  for (const w of learned) pool.set(w.word.toLowerCase(), w)
  // 错词本里的词（都做过题，天然属于「学过」范畴；防御性再并一次）
  for (const [w] of Object.entries(p.wrong)) {
    const hit = book.byKey.get(w.toLowerCase())
    if (hit) pool.set(w.toLowerCase(), hit)
  }
  const arr = [...pool.values()]
  const mode = currentShuffleMode()
  const epoch = orderEpoch(mode, todayStrOf(), weekStartOf())
  const salt = orderSalt(mode, weekStartOf(), currentSalt())
  const shuffled = seededShuffle(arr, makeSeed(epoch, activeProfileId(), 'mix', salt))
  const picked = shuffled.slice(0, Math.min(12, shuffled.length))
  const track: Track = {
    id: 'mix',
    kind: 'daily',
    group: 'daily',
    order: 0,
    label: '智能混合卷 · ' + picked.length + ' 词',
    file: '',
    seconds: 0,
    wordCount: picked.length,
    sections: [],
    items: picked.map((w, i) => [i + 1, w.word, w.cn, 0, 0] as ItemTuple),
  }
  return { track, poolSize: arr.length }
}

function todayStrOf(): string {
  const d = new Date()
  const z = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
}

function weekStartOf(): string {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  const z = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
}

/**
 * 今日到期复习词卷（v3.1 全词复习队列）：/d/review
 * 在线听写、纸质卷、纸听三条线都吃这个 id，词单天然一致。
 * v3.8：合并错词本到期词（错词优先排前）——以前两条复习线各走各的，
 * 错词本到期的词只在错词本页躺着，点「去复习巩固」听写碰不到它们。
 * 一张卷交卷后 submitSession 同时推进两条线（队列 advance + 错词 advanceWrong）。
 */
export async function getReviewTrack(): Promise<Track | undefined> {
  const p = load(activeProfileId())
  const wrongDue = dueWrongWords(p)
  const queueDue = dueReviews(p)
  const seen = new Set<string>()
  const items: ItemTuple[] = []
  for (const w of wrongDue) {
    if (seen.has(w.word)) continue
    seen.add(w.word)
    items.push([items.length + 1, w.word, w.cn || WORD_MAP[w.word]?.cn || '', 0, 0])
  }
  for (const d of queueDue) {
    if (seen.has(d.word)) continue
    seen.add(d.word)
    items.push([items.length + 1, d.word, WORD_MAP[d.word]?.cn || '', 0, 0])
  }
  return {
    id: 'review', kind: 'daily', group: 'daily', order: 0,
    label: `今日复习（${items.length} 词）`, file: '', seconds: Math.max(30, items.length * 8),
    wordCount: items.length, sections: [], items,
  }
}

/**
 * 错词五关词卷（v3.6）：/learn/wcustom、/translate/wcustom、…、/d/wcustom。
 * 词单来自错词本勾选/开始复习时写进 sessionStorage 的 custom-words（各关只读不消费，
 * 保证五关看到同一份词单、同一种顺序）。没有词单时返回 undefined，页面给出引导。
 */
export function getWrongQuizTrack(): Track | undefined {
  try {
    const cw = sessionStorage.getItem('custom-words')
    if (!cw) return undefined
    const list = JSON.parse(cw) as { word: string; cn: string }[]
    if (!Array.isArray(list) || !list.length) return undefined
    return {
      id: 'wcustom', kind: 'daily', group: 'daily', order: 0,
      label: `错词五关（${list.length} 词）`, file: '', seconds: Math.max(30, list.length * 8),
      wordCount: list.length, sections: [],
      items: list.map((w, i) => [i + 1, w.word, w.cn || WORD_MAP[w.word]?.cn || '', 0, 0] as ItemTuple),
    }
  } catch {
    return undefined
  }
}

/**
 * 扩展版 getTrack：内置静态任务之外，还支持动态任务
 *   /d/plan  今日计划   /d/mix  智能混合卷   /d/review  今日复习   /d/wcustom  错词五关
 * 打印卷/翻译关/听写页统一走这个入口。
 */
export async function getTrackAny(id: string): Promise<Track | undefined> {
  const t = getTrack(id)
  if (t) return t
  if (id === 'plan') return (await getPlanTrack()).track
  if (id === 'mix') return (await getMixTrack()).track
  if (id === 'review') return await getReviewTrack()
  if (id === 'wcustom') return getWrongQuizTrack()
  return undefined
}
