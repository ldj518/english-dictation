/**
 * POST /api/answer —— 逐题落库（v6）；v8 起支持批量。
 *
 * 为什么要这个接口：
 *   answers 表原来只在「结算」时由 /api/session 批量写，
 *   而 v5 的每日流水线（/today）根本不走结算——孩子中途退出，
 *   「今天错了哪几个词」一条记录都不留，家长后台只能看到分段耗时。
 *   现在答一题写一条：`session_id` 由客户端开局时生成，
 *   结算时 /api/session 会用同一个 id 重写一遍（先删后插），不会重复。
 *
 * v8 批量（为什么必须改）：
 *   国内访问 Cloudflare 落在洛杉矶，一次往返 1–9 秒、晚上还会超时。
 *   原来一题一请求 = 一场 30 题要 30 次跨境往返，手机一直在发请求、
 *   一直在掉电，还挤占真正要紧的请求（进度、音频）。
 *   现在客户端攒 5 题发一次，一趟写 5 条；离线就先塞本地队列。
 *
 * 请求体两种形态：
 *   单条：{ studentId, sessionId, dayKey?, word, cn?, input?, correct, seq?, ms?,
 *          attempts?, peek?, fast?, kind?, at? }
 *   批量：{ answers: [ 同上 ... ] }   ← 最多 50 条，超出截断
 *
 * 设计取舍：
 *  · 单条写入失败的代价必须小——客户端 fire-and-forget，不阻塞答题；
 *    所以这里的校验只挡「明显不合法」，不追求严格。批量里坏一条就跳过那条，
 *    不能让一条脏数据把另外四条也带下去。
 *  · peek（看答案）要如实记：它是「会选被记成会写」那批脏数据的源头，
 *    家长后台按 peek 比例一眼能看出这孩子是不是在瞎点。
 */
import { type Env, ok, fail, preflight, dayKey } from './_utils'

const SID_RE = /^s_[a-zA-Z0-9_]{6,40}$/

/**
 * 允许落库的题型（v7）。白名单而不是直接存：
 * 这一列要拿去 GROUP BY 出家长看的条形图，混进任意串就会多出
 * 「Other」这种没法解释的行。不认识的题型落空串，前端归到「未分型」。
 */
const KINDS = new Set(['flash', 'teach', 'pick', 'spell', 'sent', 'mean', 'paper'])

/** 一次请求最多写多少条。50 条 × 14 参数远低于 D1 单语句上限，留足余量 */
const BATCH_MAX = 50

interface RawRow {
  studentId?: string; sessionId?: string; dayKey?: string
  word?: string; cn?: string; input?: string; correct?: boolean
  kind?: string
  seq?: number; ms?: number; attempts?: number; peek?: boolean; fast?: boolean; at?: number
}

/** 校验并归一一条；不合法返回 null（批量时跳过该条，不拖累整批） */
function norm(b: RawRow): (string | number)[] | null {
  const studentId = (b.studentId || '').trim()
  const word = (b.word || '').trim()
  if (!studentId || !word) return null

  const sessionId = SID_RE.test(String(b.sessionId || '')) ? String(b.sessionId) : ''
  if (!sessionId) return null

  const at = Number.isFinite(b.at) ? Number(b.at) : Date.now()
  const dk = String(b.dayKey || '').trim() || dayKey(at)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null

  const kind = KINDS.has(String(b.kind || '')) ? String(b.kind) : ''

  return [
    sessionId, studentId, dk, at, word.slice(0, 60), (b.cn || '').slice(0, 120),
    (b.input || '').slice(0, 200), b.correct ? 1 : 0,
    Math.max(0, Math.round(b.seq || 0)),
    Math.max(0, Math.round(b.ms || 0)),
    Math.max(1, Math.round(b.attempts || 1)),
    b.peek ? 1 : 0, b.fast ? 1 : 0, kind,
  ]
}

const SQL = `INSERT INTO answers
  (session_id, student_id, day_key, at, word, cn, input, correct, seq, ms, attempts, peek, fast, kind)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as RawRow & { answers?: RawRow[] }

    // 批量：坏一条跳一条；一条都不合法才报错
    const list = Array.isArray(body.answers) ? body.answers.slice(0, BATCH_MAX) : [body]
    const rows = list.map(norm).filter((r): r is (string | number)[] => !!r)
    if (!rows.length) return fail(list.length ? '没有一条作答合法' : '缺少 word')

    if (rows.length === 1) {
      await env.DB.prepare(SQL).bind(...rows[0]).run()
    } else {
      // D1 batch 走一次往返：国内网络下这是 5 次跨境变 1 次的关键
      await env.DB.batch(rows.map(r => env.DB.prepare(SQL).bind(...r)))
    }

    return ok({ n: rows.length, skipped: list.length - rows.length })
  } catch (e) {
    return fail('写入作答失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
