/**
 * GET  /api/shuffle   读取全局「出题顺序盐 + 顺序模式」
 * POST /api/shuffle   家长点「立即重排」换新盐 / 切换顺序模式
 *
 * 顺序种子 = 时间成分(epoch) | 身份 | 任务 | 盐：
 * - daily（默认）：epoch=今天 → 天然每天一换
 * - weekly：epoch=本周一（前端本地算） → 一周内稳定
 * - manual：epoch=固定串 → 家长不点重排就永远不变
 * 盐在三种模式下都参与种子，所以「立即重排」任何档位都立刻生效。
 *
 * 模式和盐都存 app_settings 表，云端为准 —— 家长切档/重排后，
 * 所有设备（含打印页）下次进页面就是新顺序。
 */
import { type Env, ok, fail, preflight } from './_utils'

const SALT_KEY = 'shuffle_salt'
const MODE_KEY = 'shuffle_mode'
const MODES = ['daily', 'weekly', 'manual'] as const

interface SettingRow { value: string; updated_at: number }

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key = ?`
  ).bind(key).first<SettingRow>()
  return row?.value ?? null
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const [salt, mode] = await Promise.all([
      readSetting(env, SALT_KEY),
      readSetting(env, MODE_KEY),
    ])
    return ok({
      salt: salt || '',
      mode: (mode as typeof MODES[number]) || 'daily',
      updatedAt: null,
    })
  } catch (e) {
    return fail('读取失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { salt?: string; mode?: string }

    // 换盐（立即重排）
    if (body.salt !== undefined) {
      const salt = (body.salt || '').trim()
      if (!/^[a-z0-9]{4,16}$/.test(salt)) return fail('盐格式不对')
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(SALT_KEY, salt, Date.now()).run()
      return ok({ salt })
    }

    // 切模式（每天换 / 每周换 / 家长手动）
    if (body.mode !== undefined) {
      if (!(MODES as readonly string[]).includes(body.mode)) return fail('模式不对')
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(MODE_KEY, body.mode, Date.now()).run()
      return ok({ mode: body.mode })
    }

    return fail('缺少 salt 或 mode')
  } catch (e) {
    return fail('保存失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
