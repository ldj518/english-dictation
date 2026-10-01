import type { AudioItem } from '../types'

/**
 * 音频基础地址。
 * - 开发/本地：'audio/'（public/audio 下的相对路径）
 * - 线上：Cloudflare R2 的自定义域名或 r2.dev 地址
 *
 * 通过 VITE_AUDIO_BASE 环境变量在构建时注入，避免改代码。
 */
export const AUDIO_BASE: string = (() => {
  const v = (import.meta as unknown as { env?: Record<string, string> }).env
  const base = v?.VITE_AUDIO_BASE
  if (base) return base.replace(/\/$/, '') + '/'
  return 'audio/'
})()

/** 给定相对路径（如 words/xxx.mp3）拼出完整 URL */
export function audioUrl(rel: string): string {
  return AUDIO_BASE + rel.replace(/^\//, '')
}

/** AudioItem 的最终播放 URL（file 为 null 时返回 null，走 Web Speech） */
export function itemUrl(item: AudioItem): string | null {
  if (!item.file) return null
  return audioUrl(item.file)
}

/** 整轨 URL */
export function trackUrl(file: string): string {
  return audioUrl(file)
}
