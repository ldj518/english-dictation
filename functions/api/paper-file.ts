/**
 * GET /api/paper-file?key=papers/p1/2026-10-01/p_xxx.jpg
 * 从 R2 取纸质卷照片原图（家长后台 / 分享页用）。
 *
 * 只放行 papers/ 前缀，防止被当代理读取桶里其他对象（音频等有公开地址，不需要这口）。
 */
import { type Env, fail, preflight } from './_utils'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)
    const url = new URL(request.url)
    const key = url.searchParams.get('key') || ''
    if (!key.startsWith('papers/') || key.includes('..')) return fail('非法 key', 400)

    const obj = await env.BUCKET.get(key)
    if (!obj) return fail('照片不存在', 404)

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg')
    headers.set('Cache-Control', 'private, max-age=86400')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(obj.body, { headers })
  } catch (e) {
    return fail('读取照片失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
