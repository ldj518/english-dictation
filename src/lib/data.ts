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
