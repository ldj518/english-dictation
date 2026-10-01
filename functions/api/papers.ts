/**
 * GET /api/papers?studentId=p1 —— 列出孩子的纸质卷照片（R2）。
 *
 * 返回对象键列表，前端按 key 里的 dayKey 分组展示：
 *   papers/{studentId}/{dayKey}/{uid}.{ext}
 * 照片本体走 GET /api/paper-file?key=... 按需取。
 */
import { type Env, ok, fail, preflight } from './_utils'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)
    const url = new URL(request.url)
    const studentId = (url.searchParams.get('studentId') || '').trim()
    if (!studentId) return fail('缺少 studentId')

    const prefix = `papers/${studentId}/`
    const list = await env.BUCKET.list({ prefix, limit: 500 })
    const photos = list.objects
      .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() }))
      .sort((a, b) => b.uploaded - a.uploaded)

    return ok({ photos, truncated: list.truncated })
  } catch (e) {
    return fail('读取照片列表失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
