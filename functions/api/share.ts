/**
 * POST /api/share   生成只读分享（家长发微信用）
 * GET  /api/share?id=sh_xxx   读取分享内容
 *
 * 设计：链接即凭证。id 用 14 位随机串，不设登录；
 * payload 是一份成绩快照 JSON（对错统计 + 错词 + 纸质卷照片 key），落 D1。
 * 不存任何明文答案卷面，泄露链接最多看到成绩和错词。
 */
import { type Env, ok, fail, preflight, uid } from './_utils'

const MAX_PAYLOAD = 100 * 1024   // 100KB 上限

interface ShareRow { payload: string; created_at: number }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { payload?: unknown }
    if (!body.payload || typeof body.payload !== 'object') return fail('缺少 payload')
    const payload = JSON.stringify(body.payload)
    if (payload.length > MAX_PAYLOAD) return fail('内容过大')
    const id = uid('sh_') + Math.random().toString(36).slice(2, 8)
    await env.DB.prepare(
      `INSERT INTO shares (id, payload, created_at) VALUES (?,?,?)`
    ).bind(id, payload, Date.now()).run()
    return ok({ id })
  } catch (e) {
    return fail('创建分享失败: ' + (e as Error).message, 500)
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const id = (new URL(request.url).searchParams.get('id') || '').trim()
    if (!id || !/^sh_[a-z0-9]+$/.test(id)) return fail('链接无效')
    const row = await env.DB.prepare(
      `SELECT payload, created_at FROM shares WHERE id = ?`
    ).bind(id).first<ShareRow>()
    if (!row) return fail('链接无效或已失效', 404)
    return ok({ payload: JSON.parse(row.payload), createdAt: row.created_at })
  } catch (e) {
    return fail('读取分享失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
