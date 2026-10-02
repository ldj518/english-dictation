/**
 * POST /api/session —— 上报一次听写结果。
 *
 * 这是后端的核心写入入口。在线听写、期末模考、纸质批改三种来源都走这里。
 *
 * 请求体：
 * {
 *   studentId: 'p1',
 *   trackId: 'day01',
 *   trackLabel: '第 1 天',
 *   kind: 'daily' | 'unit' | 'final',
 *   mode: 'online' | 'exam' | 'paper',
 *   seconds: 123,
 *   records: [{ no, word, cn, input, correct }],
 *   photoKey?: 'papers/xxx.jpg'   // 纸质卷照片（可选）
 * }
 */
import { type Env, ok, fail, preflight, dayKey, uid } from './_utils'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const body = await request.json() as {
      studentId?: string
      trackId?: string
      trackLabel?: string
      kind?: string
      mode?: string
      seconds?: number
      records?: { no?: number; word: string; cn?: string; input?: string; correct?: boolean }[]
      photoKey?: string
    }

    const studentId = (body.studentId || '').trim()
    const trackId = (body.trackId || '').trim()
    const records = body.records || []

    if (!studentId) return fail('缺少 studentId')
    if (!trackId) return fail('缺少 trackId')
    if (!records.length) return fail('records 为空')

    const total = records.length
    const right = records.filter(r => r.correct).length
    const score = Math.round((right / total) * 100)
    const seconds = Math.max(0, Math.round(body.seconds || 0))
    const now = Date.now()
    const dk = dayKey(now)
    const sessionId = uid('s_')

    // 1. 写 sessions
    await env.DB.prepare(
      `INSERT INTO sessions
       (id, student_id, track_id, track_label, kind, mode, total, right_count, score, seconds, created_at, day_key, photo_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      sessionId, studentId, trackId, body.trackLabel || trackId,
      body.kind || 'daily', body.mode || 'online',
      total, right, score, seconds, now, dk, body.photoKey || null
    ).run()

    // 2. 批量写 answers（D1 batch，一次往返）
    const stmts = records.map((r, i) =>
      env.DB.prepare(
        `INSERT INTO answers (session_id, word, cn, input, correct, seq) VALUES (?,?,?,?,?,?)`
      ).bind(sessionId, r.word, r.cn || '', r.input || '', r.correct ? 1 : 0, r.no ?? i + 1)
    )
    // D1 batch 每条最多 100 个语句，分批
    for (let i = 0; i < stmts.length; i += 90) {
      await env.DB.batch(stmts.slice(i, i + 90))
    }

    // 3. 更新 daily_stats 物化表（累加）
    await env.DB.prepare(
      `INSERT INTO daily_stats (student_id, day_key, sessions, total, right_count, seconds, avg_score)
       VALUES (?,?,1,?,?,?,?)
       ON CONFLICT(student_id, day_key) DO UPDATE SET
         sessions = sessions + 1,
         total = total + excluded.total,
         right_count = right_count + excluded.right_count,
         seconds = seconds + excluded.seconds,
         avg_score = CAST((right_count + excluded.right_count) * 100.0 / (total + excluded.total) AS INTEGER)`
    ).bind(studentId, dk, total, right, seconds, score).run()

    return ok({ sessionId, score, right, total, dayKey: dk })
  } catch (e) {
    return fail('上报失败: ' + (e as Error).message, 500)
  }
}

/**
 * GET /api/session?id=s_xxx —— 查一次听写的逐题明细（v3.2）。
 *
 * 家长看板「最近听写」点开某条记录后，用它拉 answers 表里的逐题对错。
 * 权限说明：session id 是随机串（uid 生成），不可枚举，与分享链接同级的暴露面；
 * 不含任何身份信息以外的内容，孩子端也无从用它刷分（只读）。
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const id = (new URL(request.url).searchParams.get('id') || '').trim()
    if (!id) return fail('缺少 id')

    const sess = await env.DB.prepare(
      `SELECT id, student_id, track_id, track_label, kind, mode, total, right_count,
              score, seconds, created_at, day_key, photo_key
       FROM sessions WHERE id = ?`
    ).bind(id).first()
    if (!sess) return fail('没有这条记录', 404)

    const { results } = await env.DB.prepare(
      `SELECT word, cn, input, correct, seq FROM answers WHERE session_id = ? ORDER BY seq`
    ).bind(id).all()

    return ok({ session: sess, records: results || [] })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
