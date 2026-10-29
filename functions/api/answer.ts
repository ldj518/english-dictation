/**
 * POST /api/answer —— 逐题落库（v6）。
 *
 * 为什么要这个接口：
 *   answers 表原来只在「结算」时由 /api/session 批量写，
 *   而 v5 的每日流水线（/today）根本不走结算——孩子中途退出，
 *   「今天错了哪几个词」一条记录都不留，家长后台只能看到分段耗时。
 *   现在答一题写一条：`session_id` 由客户端开局时生成，
 *   结算时 /api/session 会用同一个 id 重写一遍（先删后插），不会重复。
 *
 * 请求体：
 * { studentId, sessionId, dayKey?, word, cn?, input?, correct, seq?,
 *   ms?, attempts?, peek?, fast?, at? }
 *
 * 设计取舍：
 *  · 单条写入失败的代价必须小——客户端 fire-and-forget，不阻塞答题；
 *    所以这里的校验只挡「明显不合法」，不追求严格。
 *  · peek（看答案）要如实记：它是「会选被记成会写」那批脏数据的源头，
 *    家长后台按 peek 比例一眼能看出这孩子是不是在瞎点。
 */
import { type Env, ok, fail, preflight, dayKey } from './_utils'

const SID_RE = /^s_[a-zA-Z0-9_]{6,40}$/

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = await request.json() as {
      studentId?: string; sessionId?: string; dayKey?: string
      word?: string; cn?: string; input?: string; correct?: boolean
      seq?: number; ms?: number; attempts?: number; peek?: boolean; fast?: boolean; at?: number
    }

    const studentId = (b.studentId || '').trim()
    const word = (b.word || '').trim()
    if (!studentId) return fail('缺少 studentId')
    if (!word) return fail('缺少 word')

    const sessionId = SID_RE.test(String(b.sessionId || '')) ? String(b.sessionId) : ''
    if (!sessionId) return fail('sessionId 不合法')

    const at = Number.isFinite(b.at) ? Number(b.at) : Date.now()
    const dk = (b.dayKey || '').trim() || dayKey(at)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return fail('dayKey 不合法')

    await env.DB.prepare(
      `INSERT INTO answers
       (session_id, student_id, day_key, at, word, cn, input, correct, seq, ms, attempts, peek, fast)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      sessionId, studentId, dk, at, word.slice(0, 60), (b.cn || '').slice(0, 120),
      (b.input || '').slice(0, 200), b.correct ? 1 : 0,
      Math.max(0, Math.round(b.seq || 0)),
      Math.max(0, Math.round(b.ms || 0)),
      Math.max(1, Math.round(b.attempts || 1)),
      b.peek ? 1 : 0, b.fast ? 1 : 0
    ).run()

    return ok({})
  } catch (e) {
    return fail('写入作答失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
