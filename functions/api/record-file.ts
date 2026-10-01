/**
 * GET /api/record-file?key=records/p1/2026-10-01/day01/03-apple-xxx.webm
 * 从 R2 取跟读录音音频流（家长看板 / 分享页用）。
 *
 * 只放行 records/ 前缀，防止被当代理读取桶里其他对象。
 */
import { type Env, fail, preflight } from './_utils'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)
    const url = new URL(request.url)
    const key = url.searchParams.get('key') || ''
    if (!key.startsWith('records/') || key.includes('..')) return fail('非法 key', 400)

    const obj = await env.BUCKET.get(key)
    if (!obj) return fail('录音不存在', 404)

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'audio/webm')
    headers.set('Cache-Control', 'private, max-age=86400')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(obj.body, { headers })
  } catch (e) {
    return fail('读取录音失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
