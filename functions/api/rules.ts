/**
 * GET  /api/rules   读取家长管控规则（所有设备启动时拉取）
 * POST /api/rules   家长中心（PIN 门禁后）保存规则
 *
 * 规则与「设备偏好」分离：settings 里的体验项（音量/倍速）仍按设备各自存，
 * 这里是「管控项」——云端为准，家长改完全部设备生效：
 * {
 *   kbBuiltIn: true,          // 内置字母键盘（锁开，防输入法联想）
 *   shuffle: true,            // 随机出题（防背顺序）
 *   syncPaper: true,          // 纸质伴写
 *   prepMode: 'recommended',  // 预习环节：recommended 可跳过 / force 强制 / off 关闭
 *   parentMessage: '…'        // 家长寄语（孩子首页显示，可为空）
 * }
 *
 * 存储：app_settings 表 key='parent_rules'，与 shuffle_mode 同一套机制。
 */
import { type Env, ok, fail, preflight } from './_utils'

const RULES_KEY = 'parent_rules'
const PREP_MODES = ['recommended', 'force', 'off'] as const
type PrepMode = typeof PREP_MODES[number]

interface RulePayload {
  kbBuiltIn?: boolean
  shuffle?: boolean
  syncPaper?: boolean
  prepMode?: PrepMode
  parentMessage?: string
}

interface SettingRow { value: string; updated_at: number }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await env.DB.prepare(
      `SELECT value FROM app_settings WHERE key = ?`
    ).bind(RULES_KEY).first<SettingRow>()
    const rules: RulePayload = row ? JSON.parse(row.value) : {}
    return ok({ rules, updatedAt: row?.updated_at ?? null })
  } catch (e) {
    return fail('读取规则失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as RulePayload
    const rules: RulePayload = {}

    if (body.kbBuiltIn !== undefined) rules.kbBuiltIn = !!body.kbBuiltIn
    if (body.shuffle !== undefined) rules.shuffle = !!body.shuffle
    if (body.syncPaper !== undefined) rules.syncPaper = !!body.syncPaper
    if (body.prepMode !== undefined) {
      if (!(PREP_MODES as readonly string[]).includes(body.prepMode)) return fail('预习档位不对')
      rules.prepMode = body.prepMode
    }
    if (body.parentMessage !== undefined) {
      // 100 字上限：一句话足够，也防塞奇怪内容
      rules.parentMessage = String(body.parentMessage).slice(0, 100)
    }

    if (!Object.keys(rules).length) return fail('没有要保存的内容')

    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(RULES_KEY, JSON.stringify(rules), Date.now()).run()

    return ok({ rules })
  } catch (e) {
    return fail('保存规则失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
