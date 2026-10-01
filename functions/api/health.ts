/** GET /api/health —— 健康检查，确认 D1/R2 绑定正常。 */
import { type Env, ok } from './_utils'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const out: Record<string, unknown> = { time: new Date().toISOString() }
  try {
    const r = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>()
    out.db = 'ok'
    out.sessions = r?.n ?? 0
  } catch (e) {
    out.db = 'error: ' + (e as Error).message
  }
  out.bucket = ctx.env.BUCKET ? 'bound' : 'missing'
  return ok(out)
}
