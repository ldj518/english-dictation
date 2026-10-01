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
      const r = await fetch(audioUrl('manifest.json'))
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
