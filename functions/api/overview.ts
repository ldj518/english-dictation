/**
 * GET /api/overview —— 家长看板：一次拿到全部孩子的 今日/本周/本月 概览。
 *
 * 无需传参：返回所有 student 的汇总，家长一眼看两个孩子。
 */
import { type Env, ok, fail, preflight, dayKey } from './_utils'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { env } = ctx
  try {
    const now = Date.now()
    const today = dayKey(now)

    const wk = new Date(now + 8 * 3600 * 1000)
    const dow = (wk.getUTCDay() + 6) % 7
    wk.setUTCDate(wk.getUTCDate() - dow)
    wk.setUTCHours(0, 0, 0, 0)
    const weekStart = dayKey(wk.getTime() - 8 * 3600 * 1000)

    const mo = new Date(now + 8 * 3600 * 1000)
    mo.setUTCDate(1); mo.setUTCHours(0, 0, 0, 0)
    const monthStart = dayKey(mo.getTime() - 8 * 3600 * 1000)

    const rows = await env.DB.prepare(
      `SELECT
         s.student_id,
         COUNT(*) AS sessions,
         COALESCE(SUM(s.total),0) AS total,
         COALESCE(SUM(s.right_count),0) AS right_count,
         COALESCE(SUM(s.seconds),0) AS seconds,
         COALESCE(AVG(s.score),0) AS avg_score
       FROM sessions s
       WHERE s.day_key >= ?
       GROUP BY s.student_id`
    ).bind(monthStart).all<{
      student_id: string; sessions: number; total: number
      right_count: number; seconds: number; avg_score: number
    }>()

    const byStudent: Record<string, { today: Stat; week: Stat; month: Stat }> = {}
    const blank = (): Stat => ({ sessions: 0, total: 0, right: 0, acc: 0, seconds: 0, avgScore: 0 })

    const init = (id: string) => {
      byStudent[id] ||= { today: blank(), week: blank(), month: blank() }
    }

    for (const r of rows.results || []) {
      init(r.student_id)
      byStudent[r.student_id].month = {
        sessions: r.sessions, total: r.total, right: r.right_count,
        acc: r.total ? Math.round((r.right_count / r.total) * 100) : 0,
        seconds: r.seconds, avgScore: Math.round(r.avg_score),
      }
    }

    // 今日
    const tRows = await env.DB.prepare(
      `SELECT student_id, COUNT(*) AS sessions, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(right_count),0) AS right_count, COALESCE(SUM(seconds),0) AS seconds,
              COALESCE(AVG(score),0) AS avg_score
       FROM sessions WHERE day_key = ? GROUP BY student_id`
    ).bind(today).all<never>()

    for (const r of (tRows.results || []) as unknown as MonthRow[]) {
      init(r.student_id)
      byStudent[r.student_id].today = {
        sessions: r.sessions, total: r.total, right: r.right_count,
        acc: r.total ? Math.round((r.right_count / r.total) * 100) : 0,
        seconds: r.seconds, avgScore: Math.round(r.avg_score),
      }
    }

    // 本周
    const wRows = await env.DB.prepare(
      `SELECT student_id, COUNT(*) AS sessions, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(right_count),0) AS right_count, COALESCE(SUM(seconds),0) AS seconds,
              COALESCE(AVG(score),0) AS avg_score
       FROM sessions WHERE day_key >= ? GROUP BY student_id`
    ).bind(weekStart).all<never>()

    for (const r of (wRows.results || []) as unknown as MonthRow[]) {
      init(r.student_id)
      byStudent[r.student_id].week = {
        sessions: r.sessions, total: r.total, right: r.right_count,
        acc: r.total ? Math.round((r.right_count / r.total) * 100) : 0,
        seconds: r.seconds, avgScore: Math.round(r.avg_score),
      }
    }

    return ok({ today, weekStart, monthStart, byStudent })
  } catch (e) {
    return fail('总览失败: ' + (e as Error).message, 500)
  }
}

interface Stat { sessions: number; total: number; right: number; acc: number; seconds: number; avgScore: number }
interface MonthRow { student_id: string; sessions: number; total: number; right_count: number; seconds: number; avg_score: number }

export const onRequestOptions: PagesFunction = async () => preflight()
