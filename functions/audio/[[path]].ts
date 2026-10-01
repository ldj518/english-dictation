/**
 * GET /audio/<key> —— 音频同域代理（v2.4 关键修复）。
 *
 * 背景：此前音频直连 R2 的 r2.dev 原始域名（pub-xxxx.r2.dev），
 * 该域名在国内绝大多数网络下不可达——网页打得开、音频永远加载不出来，
 * 表现就是「微信里/浏览器里都没有声音」。
 *
 * 修法：主站域名（tingxie.5208090.xyz）能打开就说明可达，
 * 音频统一改走同域 /audio/*，由此代理到 R2，并用 caches.default
 * 做边缘缓存（文件名即内容 hash，内容永不变，缓存一年）。
 *
 * 放行范围：words/、tracks/ 前缀与 manifest.json，其余一律 400，
 * 防止被当成整桶代理。
 */
import { type Env, fail, preflight } from '../api/_utils'

const ALLOWED_PREFIXES = ['words/', 'tracks/']

/** 解析 Range 头（iOS Safari 播放音频前会发 bytes=0-1 探测） */
function parseRange(header: string | null):
  | { offset: number; length?: number }
  | { suffix: number }
  | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {
    // bytes=-N：后 N 字节
    const suffix = parseInt(b, 10)
    return suffix > 0 ? { suffix } : null
  }
  const offset = parseInt(a, 10)
  if (b === '') return { offset } // bytes=N- ：到末尾
  const end = parseInt(b, 10)
  if (end < offset) return null
  return { offset, length: end - offset + 1 }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)

    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.replace(/^\/audio\//, ''))
    if (!key || key.includes('..') || key.includes('\\')) return fail('非法 key', 400)
    const allowed =
      key === 'manifest.json' || ALLOWED_PREFIXES.some(p => key.startsWith(p))
    if (!allowed) return fail('非法 key', 400)

    const range = parseRange(request.headers.get('Range'))

    // ── Range 请求（iOS 探测/拖动）：直连 R2 返回 206，不进缓存 ──
    if (range) {
      const r2range =
        'suffix' in range
          ? { suffix: range.suffix }
          : { offset: range.offset, ...(range.length !== undefined ? { length: range.length } : {}) }
      const obj = await env.BUCKET.get(key, { range: r2range })
      if (!obj) return fail('音频不存在', 404)
      const total = obj.size
      const start = 'suffix' in range ? Math.max(0, total - range.suffix) : range.offset
      const len = 'suffix' in range ? total - start : (range.length ?? total - start)
      const h = new Headers()
      obj.writeHttpMetadata(h)
      h.set('Content-Type', obj.httpMetadata?.contentType || 'audio/mpeg')
      h.set('Accept-Ranges', 'bytes')
      h.set('Content-Range', `bytes ${start}-${start + len - 1}/${total}`)
      h.set('Cache-Control', 'public, max-age=31536000, immutable')
      return new Response(obj.body, { status: 206, headers: h })
    }

    // ── 全量请求：边缘缓存优先 ──
    const cache = caches.default
    const cached = await cache.match(request)
    if (cached) return cached

    const obj = await env.BUCKET.get(key)
    if (!obj) return fail('音频不存在', 404)

    const h = new Headers()
    obj.writeHttpMetadata(h)
    h.set('Content-Type', obj.httpMetadata?.contentType || 'audio/mpeg')
    h.set('Cache-Control', 'public, max-age=31536000, immutable')
    h.set('Accept-Ranges', 'bytes')
    h.set('ETag', `"${obj.httpEtag}"`)
    const resp = new Response(obj.body, { status: 200, headers: h })
    // 内容 hash 文件名，永不变化，放心写边缘缓存
    waitUntil(cache.put(request, resp.clone()))
    return resp
  } catch (e) {
    return fail('读取音频失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
