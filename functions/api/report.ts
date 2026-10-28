/**
 * /api/report —— 战报归档。
 *
 * POST：把六块纯文本 + 结构化 payload 存进 report_out（家长页回看/转发用）
 * GET ：?studentId=&day= 取某天；不带 day 取最近 14 条
 */
import { type Env, ok, fail, preflight, dayKey as todayKey } from './_utils'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const b = await request.json() as {
      studentId?: string; dayKey?: string; text?: string; payload?: unknown
    }
    const studentId = (b.studentId || '').trim()
    if (!studentId) return fail('缺少 studentId')
    const dk = (b.dayKey || '').trim() || todayKey()
    await env.DB.prepare(
      `INSERT INTO report_out (student_id, day_key, text, payload, created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(student_id, day_key) DO UPDATE SET
         text = excluded.text, payload = excluded.payload, created_at = excluded.created_at`
    ).bind(
      studentId, dk, b.text || '',
      JSON.stringify(b.payload || {}), Date.now()
    ).run()
    return ok({ dayKey: dk })
  } catch (e) {
    return fail('归档失败: ' + (e as Error).message, 500)
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const u = new URL(request.url)
    const studentId = (u.searchParams.get('studentId') || '').trim()
    if (!studentId) return fail('缺少 studentId')
    const dk = (u.searchParams.get('day') || '').trim()
    if (dk) {
      const row = await env.DB.prepare(
        `SELECT day_key, text, payload, created_at FROM report_out WHERE student_id = ? AND day_key = ?`
      ).bind(studentId, dk).first()
      return ok({ report: row || null })
    }
    const { results } = await env.DB.prepare(
      `SELECT day_key, text, created_at FROM report_out
       WHERE student_id = ? ORDER BY day_key DESC LIMIT 14`
    ).bind(studentId).all()
    return ok({ reports: results || [] })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
