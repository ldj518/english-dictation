import type { AudioItem } from '../types'
import { itemUrl, trackUrl } from './assets'

/** Web Speech API 兜底朗读（离线/网络差时用） */
export function speakWord(word: string, rate = 1) {
  try {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-GB'
    u.rate = rate
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
    if (vs.length) u.voice = vs.find(v => /GB|UK/i.test(v.lang + v.name)) || vs[0]
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch { /* 不支持则静默 */ }
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 预加载缓存 */
const cache = new Map<string, HTMLAudioElement>()

/** 缓存上限，防止长会话内存膨胀（每条约 40KB，200 条约 8MB） */
const CACHE_MAX = 220

function getAudio(src: string): HTMLAudioElement {
  let a = cache.get(src)
  if (!a) {
    a = new Audio(src)
    a.preload = 'auto'
    // LRU：超限时淘汰最早的一条
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first) {
        const old = cache.get(first)
        try { old?.pause() } catch { /* ignore */ }
        cache.delete(first)
      }
    }
    cache.set(src, a)
  }
  return a
}

/** 预取一个词（不播放），用于提前缓冲下一题 */
export function prefetch(item: AudioItem) {
  const url = itemUrl(item)
  if (url) {
    const a = getAudio(url)
    try { a.load() } catch { /* ignore */ }
  }
}

/** 批量预取某任务接下来的 N 个词 */
export function prefetchAhead(items: AudioItem[], from: number, n = 3) {
  for (let i = from + 1; i <= Math.min(items.length - 1, from + n); i++) {
    prefetch(items[i])
  }
}

export function preload(src: string) {
  const a = getAudio(src)
  try { a.load() } catch { /* ignore */ }
}

/**
 * 播放一个词的音频。
 * @param item 词条（file 为 null 时回退到 Web Speech）
 * @param rate 播放倍速
 * @returns 播放时长（毫秒估算）
 */
export function playWord(item: AudioItem, rate = 1): Promise<void> {
  return new Promise(resolve => {
    const url = itemUrl(item)
    if (!url) {
      speakWord(item.word, rate)
      resolve()
      return
    }
    const a = getAudio(url)
    a.playbackRate = rate
    a.currentTime = 0
    const done = () => { a.onended = null; a.onerror = null; resolve() }
    a.onended = done
    a.onerror = () => {
      a.onerror = null
      // 音频加载失败 → Web Speech 兜底
      speakWord(item.word, rate)
      resolve()
    }
    a.play().catch(() => {
      // 自动播放被拦，等用户手势
      resolve()
    })
  })
}

export function stopAll() {
  try { speechSynthesis.cancel() } catch { /* ignore */ }
  cache.forEach(a => { try { a.pause(); a.currentTime = 0 } catch { /* ignore */ } })
}

/** 整轨播放器：包一层，用于「连续播放」模式 */
export class TrackPlayer {
  audio: HTMLAudioElement
  private _onTime?: (t: number) => void

  constructor(trackFile: string) {
    this.audio = new Audio(trackUrl(trackFile))
    this.audio.preload = 'auto'
    this.audio.ontimeupdate = () => this._onTime?.(this.audio.currentTime)
  }

  onTime(cb: (t: number) => void) { this._onTime = cb }

  async play() {
    try { await this.audio.play() } catch { /* 需手势 */ }
  }
  pause() { this.audio.pause() }
  seek(sec: number) { try { this.audio.currentTime = sec } catch { /* ignore */ } }
  setRate(r: number) { this.audio.playbackRate = r }
  get current() { return this.audio.currentTime }
  get duration() { return this.audio.duration || 0 }

  destroy() {
    try { this.audio.pause() } catch { /* ignore */ }
    this.audio.ontimeupdate = null
  }
}
