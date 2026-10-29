import type { AudioItem } from '../types'

/**
 * 音频基础地址。
 * - 开发/本地：'audio/'（public/audio 下的相对路径，音频由 scripts/build-audio.py 本地生成）
 * - 线上：一律同域 '/audio/'，走 functions/audio/[[path]].ts 代理到 R2（带边缘缓存）。
 *   ⚠️ 不要改回 VITE_AUDIO_BASE/r2.dev 直连——r2.dev 原始域名在国内基本不可达，
 *   是「网页打得开但永远没声音」的根因（v2.4 修复）。
 *
 * ⚠️ v6 修正：开发环境原先返回相对路径 'audio/'，在 /text/:unit、/d/:id 这类嵌套路由下
 * 会被解析成 /text/audio/...；Vite 的 SPA 回退对这类地址返回 index.html（状态码仍是 200），
 * 于是 fetch(...).json() 抛错、被 catch 吞掉，表现为「清单为空、点了没声音」。
 * 两处统一用绝对路径，不依赖当前路由层级。
 */
export const AUDIO_BASE = '/audio/'

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
