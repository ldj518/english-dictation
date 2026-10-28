/**
 * /api/test —— 测验（单元闸门 / 周测）的写入与回读。
 *
 * POST：一次考试一条 test_runs + 逐题 test_items（同 id 覆盖，便于「重考最新一次」）
 * GET ：?studentId=&unit= 列表；?studentId=&latest=1 只取最近 20 次
 */
import { type Env, ok, fail, preflight } from './_utils'

interface TestBody {
  id?: string
  studentId?: string
  kind?: string
  unit?: string
  dayKey?: string
  total?: number
  right?: number
  peekN?: number
  score?: number
  pass?: boolean
  passLine?: number
  attempt?: number
  patchUntil?: string
  items?: { no?: number; word: string; qkind?: string; correct?: boolean; peek?: boolean; ms?: number; fast?: boolean }[]
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const b = await request.json() as TestBody
    const studentId = (b.studentId || '').trim()
    if (!studentId) return fail('缺少 studentId')
    const dk = (b.dayKey || '').trim()
    if (!dk) return fail('缺少 dayKey')
    const kind = b.kind === 'week' ? 'week' : 'gate'
    const now = Date.now()
    const id = (b.id || '').trim() || `${studentId}-${kind}-${b.unit || ''}-${dk}-${now}`

    await env.DB.prepare(
      `INSERT INTO test_runs
         (id, student_id, kind, unit, day_key, total, right_n, peek_n, score,
          pass, pass_line, attempt, patch_until, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         total = excluded.total, right_n = excluded.right_n, peek_n = excluded.peek_n,
         score = excluded.score, pass = excluded.pass, pass_line = excluded.pass_line,
         attempt = excluded.attempt, patch_until = excluded.patch_until`
    ).bind(
      id, studentId, kind, b.unit || null, dk,
      Math.max(0, Math.round(b.total || 0)), Math.max(0, Math.round(b.right || 0)),
      Math.max(0, Math.round(b.peekN || 0)), Math.max(0, Math.round(b.score || 0)),
      b.pass ? 1 : 0, Math.max(0, Math.round(b.passLine || 80)),
      Math.max(1, Math.round(b.attempt || 1)), b.patchUntil || null, now
    ).run()

    const items = (b.items || []).filter(x => x.word).slice(0, 60)
    if (items.length) {
      await env.DB.prepare('DELETE FROM test_items WHERE run_id = ?').bind(id).run()
      await env.DB.batch(items.map((it, i) => env.DB.prepare(
        `INSERT INTO test_items (run_id, no, word, qkind, correct, peek, ms, fast)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        id, it.no ?? i + 1, it.word, it.qkind || '',
        it.correct ? 1 : 0, it.peek ? 1 : 0,
        Math.max(0, Math.round(it.ms || 0)), it.fast ? 1 : 0
      )))
    }

    return ok({ id, items: items.length })
  } catch (e) {
    return fail('写入失败: ' + (e as Error).message, 500)
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const u = new URL(request.url)
    const studentId = (u.searchParams.get('studentId') || '').trim()
    if (!studentId) return fail('缺少 studentId')
    const unit = (u.searchParams.get('unit') || '').trim()
    const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit') || 40)))

    const sql = unit
      ? `SELECT id, kind, unit, day_key, total, right_n, peek_n, score, pass, pass_line,
                attempt, patch_until, created_at
         FROM test_runs WHERE student_id = ? AND unit = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, kind, unit, day_key, total, right_n, peek_n, score, pass, pass_line,
                attempt, patch_until, created_at
         FROM test_runs WHERE student_id = ? ORDER BY created_at DESC LIMIT ?`
    const stmt = unit
      ? env.DB.prepare(sql).bind(studentId, unit, limit)
      : env.DB.prepare(sql).bind(studentId, limit)
    const { results } = await stmt.all()
    return ok({ runs: results || [] })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
