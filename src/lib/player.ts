import type { AudioItem } from '../types'
import { itemUrl, trackUrl } from './assets'

/**
 * 慢速播放的倍速。
 *
 * 设计决策：**固定值，不乘用户设置**。
 * 早期实现是 `settings.rate * 0.7`，当用户把设置调成 0.75× 时，
 * 慢速会变成 0.525× —— 慢到听不出单词边界，等于没用。
 * 固定 0.6× 才是「听得清但明显更慢」的可用档位。
 */
export const SLOW_RATE = 0.6

/**
 * 计算实际使用的播放倍速。
 * @param slow 是否点了「慢速」
 * @param userRate 用户在设置里的默认倍速
 */
export function resolveRate(slow: boolean, userRate: number): number {
  if (slow) return SLOW_RATE
  // 兜底：设置里出现非法值（0、负、NaN）时回落到 1×，避免播放静音
  if (!Number.isFinite(userRate) || userRate <= 0) return 1
  return Math.min(2, Math.max(0.25, userRate))
}

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
 *
 * 关键：**每次播放都用独立的 Audio 元素**，不复用缓存里的同一个元素。
 * 原因（真实踩坑）：缓存复用元素时，如果上一个 play() 还没结束就再次调用
 * play()，浏览器会抛 AbortError 并忽略这次播放；而「慢速」按钮恰恰是在
 * 自动播报还没结束时被点到的 —— 于是表现为「点了没反应」。
 *
 * 代价：每词新建一个 Audio 对象，但音频文件本身走 HTTP 缓存（R2 已设
 * Cache-Control），不会重复下载，开销可忽略。
 *
 * @param item 词条（file 为 null 时回退到 Web Speech）
 * @param rate 播放倍速
 */
export function playWord(item: AudioItem, rate = 1): Promise<void> {
  return new Promise(resolve => {
    const url = itemUrl(item)
    if (!url) {
      speakWord(item.word, rate)
      resolve()
      return
    }
    // 先把正在播放的都停掉，避免声音叠在一起
    pauseAll()
    const a = new Audio(url)
    a.preload = 'auto'
    // 倍速必须在 play() 之前设好，否则部分浏览器会忽略
    a.playbackRate = rate
    a.defaultPlaybackRate = rate
    live.add(a)
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      live.delete(a)
      a.onended = null
      a.onerror = null
      resolve()
    }
    a.onended = done
    a.onerror = () => {
      live.delete(a)
      // 音频加载失败 → Web Speech 兜底
      if (!settled) { settled = true; speakWord(item.word, rate); resolve() }
    }
    a.play().catch(() => {
      // 自动播放被拦：抛错也要 resolve，否则调用方会一直等待
      if (!settled) {
        // 记录一次失败，交给上层决定是否提示
        lastError = 'autoplay-blocked'
        settled = true
        live.delete(a)
        resolve()
      }
    })
    // 兜底：极端情况下 onended 不触发（流中断），按音频时长兜底收尾
    a.onloadedmetadata = () => {
      const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : 2
      const ms = Math.max(300, (dur / Math.max(0.25, rate)) * 1000 + 400)
      setTimeout(done, ms)
    }
  })
}

/** 正在播放的元素集合 */
const live = new Set<HTMLAudioElement>()

/** 最近一次播放失败原因（供 UI 判断是否需要提示用户） */
let lastError: string | null = null
export function takeLastError(): string | null {
  const e = lastError
  lastError = null
  return e
}

/** 只暂停正在播放的元素（不影响预取缓存） */
export function pauseAll() {
  live.forEach(a => {
    try { a.pause(); a.currentTime = 0 } catch { /* ignore */ }
  })
  live.clear()
}

export function stopAll() {
  try { speechSynthesis.cancel() } catch { /* ignore */ }
  pauseAll()
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
