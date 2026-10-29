/**
 * /api/progress —— 孩子进度快照（跨设备同步，v2.6）。
 *
 * 之前进度只存 localStorage（换设备/重装=清零），名字等身份档案也只推不拉。
 * 本接口把每个孩子的完整进度 JSON 存 D1，任何设备改动后推送、
 * 打开时拉取做字段级合并（见 src/lib/sync.ts）——本地仍是第一真相源，
 * 云端快照挂了也不影响使用。
 *
 * GET  ?studentId=p1   → { ok, data, updatedAt }
 * POST { studentId, data } → upsert（服务端时间戳）
 */
import { type Env, ok, fail, preflight } from './_utils'

const ID_RE = /^[a-zA-Z0-9_-]{1,32}$/

async function ensureTable(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS progress_snapshots (
       student_id TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`
  ).bind().run()
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return fail('未绑定 D1（DB）', 500)
    await ensureTable(env)
    const sid = new URL(request.url).searchParams.get('studentId') || ''
    if (!ID_RE.test(sid)) return fail('非法 studentId', 400)
    // v6.1：断档判定不能只看快照里的 lastDay。
    // 「每日计划」那条线（第 N/37 天）不写 lastDay，日账只落在 sessions 表，
    // 结果线上 p1 学到 10-25，lastDay 却停在 10-07 → 被判断档 22 天 → 天天重启档。
    // 这里把 sessions 的最后一天一并返回，前端合并进断档计算。
    let lastActiveDay: string | null = null
    try {
      const s = await env.DB.prepare(
        `SELECT MAX(day_key) AS d FROM sessions WHERE student_id = ?`
      ).bind(sid).first<{ d: string | null }>()
      lastActiveDay = s?.d || null
    } catch {
      // sessions 表尚未建立（全新库）时忽略，不影响主流程
    }
    const row = await env.DB.prepare(
      `SELECT data, updated_at FROM progress_snapshots WHERE student_id = ?`
    ).bind(sid).first<{ data: string; updated_at: number }>()
    if (!row) return ok({ data: null, updatedAt: null, lastActiveDay })
    let data: unknown = null
    try { data = JSON.parse(row.data) } catch { data = null }
    return ok({ data, updatedAt: row.updated_at, lastActiveDay })
  } catch (e) {
    return fail('读取失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return fail('未绑定 D1（DB）', 500)
    await ensureTable(env)
    const body = await request.json() as { studentId?: string; data?: unknown }
    const sid = (body.studentId || '').trim()
    if (!ID_RE.test(sid)) return fail('非法 studentId', 400)
    if (!body.data || typeof body.data !== 'object') return fail('缺少 data')
    const json = JSON.stringify(body.data)
    if (json.length > 2_000_000) return fail('快照过大', 413)
    await env.DB.prepare(
      `INSERT INTO progress_snapshots (student_id, data, updated_at) VALUES (?,?,?)
       ON CONFLICT(student_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(sid, json, Date.now()).run()
    return ok({ studentId: sid })
  } catch (e) {
    return fail('保存失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
