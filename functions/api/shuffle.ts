/**
 * GET  /api/shuffle   读取全局「出题顺序盐」
 * POST /api/shuffle   家长点「立即重排」时换新盐 → 所有设备所有天的顺序全部重排
 *
 * 顺序种子 = 日期 | 身份 | 任务 | 盐。
 * - 每天模式（默认）：盐为空，日期本身就是盐 → 天然每天一换
 * - 手动模式：用这里存的盐，家长不点重排就永远不变
 * - 每周模式：盐 = 本周一日期，前端本地算，不需要后端
 */
import { type Env, ok, fail, preflight } from './_utils'

const SALT_KEY = 'shuffle_salt'

interface SaltRow { value: string; updated_at: number }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await env.DB.prepare(
      `SELECT value, updated_at FROM app_settings WHERE key = ?`
    ).bind(SALT_KEY).first<SaltRow>()
    return ok({ salt: row?.value || '', updatedAt: row?.updated_at || null })
  } catch (e) {
    return fail('读取失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { salt?: string }
    const salt = (body.salt || '').trim()
    if (!/^[a-z0-9]{4,16}$/.test(salt)) return fail('盐格式不对')
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(SALT_KEY, salt, Date.now()).run()
    return ok({ salt })
  } catch (e) {
    return fail('重排失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
