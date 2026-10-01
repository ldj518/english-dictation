/**
 * GET /api/stats —— 按 day / week / month 聚合统计。
 *
 * query:
 *   studentId=p1          必填
 *   range=day|week|month  可选，默认 day
 *   days=30               可选，返回最近 N 天的日趋势（默认 30）
 *
 * 返回：
 *   summary  —— 当前周期汇总（次数/题数/正确率/用时）
 *   trend    —— 按天的趋势序列（用于画折线）
 *   topWrong —— 错得最多的词
 *   streak   —— 连续打卡天数
 */
import { type Env, ok, fail, preflight, dayKey } from './_utils'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  const url = new URL(request.url)
  const studentId = url.searchParams.get('studentId') || ''
  const range = url.searchParams.get('range') || 'day'
  const days = Math.min(180, Math.max(7, Number(url.searchParams.get('days') || 30)))

  if (!studentId) return fail('缺少 studentId')

  try {
    const now = Date.now()
    const today = dayKey(now)

    // 周期起点
    const start = new Date(now + 8 * 3600 * 1000)
    if (range === 'week') {
      const dow = (start.getUTCDay() + 6) % 7
      start.setUTCDate(start.getUTCDate() - dow)
    } else if (range === 'month') {
      start.setUTCDate(1)
    }
    start.setUTCHours(0, 0, 0, 0)
    const startKey = dayKey(start.getTime() - 8 * 3600 * 1000)

    // 1. 当前周期汇总
    const sumRow = await env.DB.prepare(
      `SELECT
         COUNT(*) AS sessions,
         COALESCE(SUM(total),0) AS total,
         COALESCE(SUM(right_count),0) AS right_count,
         COALESCE(SUM(seconds),0) AS seconds,
         COALESCE(AVG(score),0) AS avg_score,
         COALESCE(MAX(score),0) AS best_score
       FROM sessions
       WHERE student_id = ? AND day_key >= ?`
    ).bind(studentId, startKey).first<{
      sessions: number; total: number; right_count: number
      seconds: number; avg_score: number; best_score: number
    }>()

    const acc = sumRow && sumRow.total ? Math.round((sumRow.right_count / sumRow.total) * 100) : 0

    // 2. 日趋势（用于折线图）
    const trendRows = await env.DB.prepare(
      `SELECT day_key, sessions, total, right_count, seconds, avg_score
       FROM daily_stats WHERE student_id = ? ORDER BY day_key DESC LIMIT ?`
    ).bind(studentId, days).all<{
      day_key: string; sessions: number; total: number
      right_count: number; seconds: number; avg_score: number
    }>()

    const trend = (trendRows.results || [])
      .map(r => ({
        day: r.day_key,
        sessions: r.sessions,
        total: r.total,
        acc: r.total ? Math.round((r.right_count / r.total) * 100) : 0,
        seconds: r.seconds,
      }))
      .reverse()

    // 3. 错词 TOP 10（近 60 天）
    const wrongRows = await env.DB.prepare(
      `SELECT a.word, a.cn, COUNT(*) AS times
       FROM answers a JOIN sessions s ON s.id = a.session_id
       WHERE s.student_id = ? AND a.correct = 0 AND s.created_at > ?
       GROUP BY a.word
       ORDER BY times DESC LIMIT 10`
    ).bind(studentId, now - 60 * 86400000).all<{ word: string; cn: string; times: number }>()

    // 4. 最近记录
    const recentRows = await env.DB.prepare(
      `SELECT id, track_id, track_label, kind, mode, total, right_count, score, seconds, created_at, day_key, photo_key
       FROM sessions WHERE student_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(studentId).all()

    // 5. 连续打卡：从今天往前数有记录的天数
    const dayRows = await env.DB.prepare(
      `SELECT DISTINCT day_key FROM sessions WHERE student_id = ? ORDER BY day_key DESC LIMIT 400`
    ).bind(studentId).all<{ day_key: string }>()

    const daySet = new Set((dayRows.results || []).map(r => r.day_key))
    let streak = 0
    const cursor = new Date(now + 8 * 3600 * 1000)
    for (let i = 0; i < 400; i++) {
      const z = (n: number) => String(n).padStart(2, '0')
      const k = `${cursor.getUTCFullYear()}-${z(cursor.getUTCMonth() + 1)}-${z(cursor.getUTCDate())}`
      if (daySet.has(k)) {
        streak++
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      } else if (i === 0) {
        // 今天还没做，从昨天继续数
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      } else break
    }

    // 总共练过多少天
    const totalDaysRow = await env.DB.prepare(
      `SELECT COUNT(DISTINCT day_key) AS n FROM sessions WHERE student_id = ?`
    ).bind(studentId).first<{ n: number }>()

    return ok({
      range,
      today,
      summary: {
        sessions: sumRow?.sessions || 0,
        total: sumRow?.total || 0,
        right: sumRow?.right_count || 0,
        acc,
        seconds: sumRow?.seconds || 0,
        avgScore: Math.round(sumRow?.avg_score || 0),
        bestScore: sumRow?.best_score || 0,
        totalDays: totalDaysRow?.n || 0,
        streak,
      },
      trend,
      topWrong: wrongRows.results || [],
      recent: recentRows.results || [],
    })
  } catch (e) {
    return fail('统计失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
