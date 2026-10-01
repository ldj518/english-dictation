/**
 * /api/students —— 孩子身份的后端镜像（用于家长看板知道有哪几个孩子）。
 *
 * GET  列出全部
 * POST 创建或更新（upsert）
 */
import { type Env, ok, fail, preflight } from './_utils'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, name, emoji, color, created_at, updated_at FROM students ORDER BY created_at ASC`
    ).all()
    return ok({ students: rows.results || [] })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const body = await ctx.request.json() as {
      id?: string; name?: string; emoji?: string; color?: string
    }
    if (!body.id || !body.name) return fail('缺少 id 或 name')

    const now = Date.now()
    await ctx.env.DB.prepare(
      `INSERT INTO students (id, name, emoji, color, created_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji,
         color=excluded.color, updated_at=excluded.updated_at`
    ).bind(body.id, body.name, body.emoji || '🙂', body.color || '#2f5fd0', now, now).run()

    return ok({ id: body.id })
  } catch (e) {
    return fail('保存失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
