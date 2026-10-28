/**
 * POST /api/day —— 上报一天的会话账本 + 词级记忆状态。
 *
 * 这是 v4 唯一的写入入口（老的 /api/session 继续用，两边并存不冲突）。
 *
 * 为什么单独的接口而不是塞进 /session：
 *  - /session 是「一次听写卷」的粒度，v4 是「一天一场」的粒度，语义不同
 *  - 词状态必须批量 upsert（368 行），混进 session 的 batch 会超 D1 单批 100 条限制
 *
 * GET /api/day?studentId=&from=&to= —— 家长后台读账本
 * GET /api/day?studentId=&queue=1     —— 读队列健康度（到期/未掌握/钉子/毕业）
 */
import { type Env, ok, fail, preflight, dayKey } from './_utils'

interface DayBody {
  studentId?: string
  dayKey?: string
  tier?: string
  effSec?: number
  idleSec?: number
  mustDone?: number
  mustTotal?: number
  qN?: number
  rightN?: number
  peekN?: number
  done?: boolean
  segs?: { k: string; label: string; min: number; q: number; right: number }[]
  /** 只上报变化的词状态，不全量推（省流量） */
  words?: {
    word: string; s: number; due: string; lapses: number
    streak: number; master: number; ok: number; n: number
  }[]
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const b = await request.json() as DayBody
    const studentId = (b.studentId || '').trim()
    if (!studentId) return fail('缺少 studentId')
    const dk = (b.dayKey || '').trim() || dayKey()
    const now = Date.now()

    // 1. 日账本（同一天重复上报 -> 覆盖，以最后一次为准）
    await env.DB.prepare(
      `INSERT INTO day_log
         (student_id, day_key, tier, eff_sec, idle_sec, must_done, must_total,
          q_n, right_n, peek_n, done, segs, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(student_id, day_key) DO UPDATE SET
         tier = excluded.tier,
         eff_sec = excluded.eff_sec, idle_sec = excluded.idle_sec,
         must_done = excluded.must_done, must_total = excluded.must_total,
         q_n = excluded.q_n, right_n = excluded.right_n, peek_n = excluded.peek_n,
         done = excluded.done, segs = excluded.segs, updated_at = excluded.updated_at`
    ).bind(
      studentId, dk, b.tier || 'normal',
      Math.max(0, Math.round(b.effSec || 0)), Math.max(0, Math.round(b.idleSec || 0)),
      Math.max(0, b.mustDone || 0), Math.max(0, b.mustTotal || 0),
      Math.max(0, b.qN || 0), Math.max(0, b.rightN || 0), Math.max(0, b.peekN || 0),
      b.done ? 1 : 0, JSON.stringify(b.segs || []), now
    ).run()

    // 2. 词状态批量 upsert（分批 90，D1 单批上限 100）
    const words = (b.words || []).filter(w => w.word && w.due)
    for (let i = 0; i < words.length; i += 90) {
      const stmts = words.slice(i, i + 90).map(w =>
        env.DB.prepare(
          `INSERT INTO word_state
             (student_id, word, s, due_day, lapses, streak, master, ok_n, all_n, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(student_id, word) DO UPDATE SET
             s = excluded.s, due_day = excluded.due_day, lapses = excluded.lapses,
             streak = excluded.streak, master = excluded.master,
             ok_n = excluded.ok_n, all_n = excluded.all_n, updated_at = excluded.updated_at`
        ).bind(
          studentId, w.word,
          Number.isFinite(w.s) ? w.s : 1, w.due,
          Math.max(0, w.lapses || 0), Math.max(0, w.streak || 0),
          Math.max(0, Math.min(2, w.master || 0)),
          Math.max(0, w.ok || 0), Math.max(0, w.n || 0), now
        )
      )
      await env.DB.batch(stmts)
    }

    return ok({ dayKey: dk, words: words.length })
  } catch (e) {
    return fail('上报失败: ' + (e as Error).message, 500)
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const u = new URL(request.url)
    const studentId = (u.searchParams.get('studentId') || '').trim()
    if (!studentId) return fail('缺少 studentId')

    // 队列健康度（后台「队列健康」卡用）
    if (u.searchParams.get('queue') === '1') {
      const today = dayKey()
      const row = await env.DB.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN master < 2 THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN master = 2 THEN 1 ELSE 0 END) AS master,
           SUM(CASE WHEN master < 2 AND due_day <= ? THEN 1 ELSE 0 END) AS due,
           SUM(CASE WHEN master < 2 AND s < 4 THEN 1 ELSE 0 END) AS weak,
           SUM(CASE WHEN master < 2 AND lapses >= 4 THEN 1 ELSE 0 END) AS nails,
           ROUND(AVG(s), 1) AS avg_s
         FROM word_state WHERE student_id = ?`
      ).bind(today, studentId).first()
      // 未来 7 天到期分布
      const { results: fc } = await env.DB.prepare(
        `SELECT due_day AS day, COUNT(*) AS n FROM word_state
         WHERE student_id = ? AND master < 2 AND due_day IS NOT NULL
           AND due_day <= date(?, '+7 day')
         GROUP BY due_day ORDER BY due_day`
      ).bind(studentId, today).all()
      return ok({ today, health: row || {}, forecast: fc || [] })
    }

    // 日账本区间（默认近 30 天）
    const from = (u.searchParams.get('from') || '').trim() || dayKey(Date.now() - 29 * 86400000)
    const to = (u.searchParams.get('to') || '').trim() || dayKey()
    const { results } = await env.DB.prepare(
      `SELECT day_key, tier, eff_sec, idle_sec, must_done, must_total,
              q_n, right_n, peek_n, done, segs, updated_at
       FROM day_log WHERE student_id = ? AND day_key BETWEEN ? AND ?
       ORDER BY day_key DESC`
    ).bind(studentId, from, to).all()

    return ok({
      days: (results || []).map((r: Record<string, unknown>) => ({
        ...r,
        segs: (() => { try { return JSON.parse(String(r.segs || '[]')) } catch { return [] } })(),
        done: !!r.done,
      })),
      from, to,
    })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
