/**
 * 音频预热（v8）。
 *
 * 为什么需要：
 *   上了离线缓存之后，页面壳是瞬开的，但音频是「用到才去拿」——
 *   孩子点了播放，才发现这个词的音频还没缓存，只能等一趟跨境请求
 *   （晚上 1–9 秒，或者直接超时）。表现成「页面挺快，一点发音就卡住」。
 *
 * 现在整场要用的词在开局时就悄悄拉一遍：一场 30 个词约 750KB，
 * 网络好的时候几秒钟拉完，之后做题全程不再碰网络。
 * 拉不动就停手——弱网下不要硬排 30 个注定超时的请求，那反而更卡。
 *
 * 注意：这里只是 fetch，命中 Service Worker 的 /audio/* 规则就被缓存下来；
 * SW 没装成也不亏，音频响应本身带 immutable 一年，浏览器 HTTP 缓存照样接住。
 */

import { audioUrl } from './assets'

/** 并发数。手机上一个音频 24–30KB，3 路并发够快又不会把带宽吃满 */
const CONCURRENCY = 3
/** 连续失败这么多次就认为网络不通，剩下的别试了 */
const MAX_FAILS = 3
/** 一次最多预热多少个。一关正常 15–30 个词，超过这个数多半是哪里传错了 */
const MAX_ITEMS = 60

let running = false

/**
 * @param files 词音频的相对路径（Q.file），空值会被跳过
 */
export async function warmAudio(files: (string | null | undefined)[]): Promise<void> {
  if (running) return
  const list = [...new Set(files.filter((f): f is string => !!f))].slice(0, MAX_ITEMS)
  if (!list.length) return
  running = true
  let fails = 0
  let i = 0
  try {
    const worker = async () => {
      while (i < list.length && fails < MAX_FAILS) {
        const rel = list[i++]
        try {
          const r = await fetch(audioUrl(rel))
          if (!r.ok) fails += 1
          else fails = 0
          // 消费掉 body，否则某些浏览器不落盘
          await r.arrayBuffer().catch(() => {})
        } catch {
          fails += 1
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
  } finally {
    running = false
  }
}
