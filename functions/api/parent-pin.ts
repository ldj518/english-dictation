/**
 * GET  /api/parent-pin   查询是否已设置解锁码（不回传码本身）
 * POST /api/parent-pin   设置/修改/校验家长解锁码
 *
 * body:
 *   { action: 'set',    pin, oldPin? }   首次设置无需 oldPin；修改必须带旧码
 *   { action: 'verify', pin }            校验，错 3 次锁 10 分钟
 *
 * 安全设计：
 * - 只存 SHA-256 哈希，不存明文（D1 泄露也拿不到码）
 * - 错 3 次锁 10 分钟，防止孩子暴力试
 * - 校验通过由前端持有 30 分钟免输窗口（parentLock.ts）
 */
import { type Env, ok, fail, preflight } from './_utils'

const LOCK_MS = 10 * 60 * 1000
const MAX_FAIL = 3

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

interface PinRow { pin_hash: string; failed: number; locked_until: number }

async function getRow(db: D1Database): Promise<PinRow | null> {
  const r = await db.prepare(
    `SELECT pin_hash, failed, locked_until FROM parent_pin WHERE id = 1`
  ).first<PinRow>()
  return r || null
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await getRow(env.DB)
    const now = Date.now()
    return ok({
      exists: !!row,
      lockedUntil: row && row.locked_until > now ? row.locked_until : null,
    })
  } catch (e) {
    return fail('查询失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    const body = await request.json() as {
      action?: 'set' | 'verify'
      pin?: string
      oldPin?: string
    }
    const pin = (body.pin || '').trim()
    if (!/^\d{4,6}$/.test(pin)) return fail('解锁码必须是 4-6 位数字')
    const hash = await sha256(pin)
    const now = Date.now()
    const row = await getRow(env.DB)

    /* ── 设置 / 修改 ── */
    if (body.action === 'set') {
      if (row) {
        // 已有码：必须验旧码，且不能处于锁定态
        if (row.locked_until > now) {
          const min = Math.ceil((row.locked_until - now) / 60000)
          return fail(`错误次数过多，已锁定，请 ${min} 分钟后再试`, 429)
        }
        const oldHash = await sha256((body.oldPin || '').trim())
        if (oldHash !== row.pin_hash) return fail('旧解锁码不对')
      }
      await env.DB.prepare(
        `INSERT INTO parent_pin (id, pin_hash, failed, locked_until, updated_at)
         VALUES (1, ?, 0, 0, ?)
         ON CONFLICT(id) DO UPDATE SET pin_hash = excluded.pin_hash, failed = 0, locked_until = 0, updated_at = excluded.updated_at`
      ).bind(hash, now).run()
      return ok({ exists: true })
    }

    /* ── 校验 ── */
    if (body.action === 'verify') {
      if (!row) return fail('还没有设置解锁码，请先到家长看板设置', 400)
      if (row.locked_until > now) {
        const min = Math.ceil((row.locked_until - now) / 60000)
        return fail(`错误次数过多，已锁定，请 ${min} 分钟后再试`, 429)
      }
      if (hash === row.pin_hash) {
        await env.DB.prepare(
          `UPDATE parent_pin SET failed = 0, locked_until = 0 WHERE id = 1`
        ).run()
        return ok({ unlocked: true })
      }
      const failed = row.failed + 1
      if (failed >= MAX_FAIL) {
        await env.DB.prepare(
          `UPDATE parent_pin SET failed = 0, locked_until = ? WHERE id = 1`
        ).bind(now + LOCK_MS).run()
        return fail('密码连错 3 次，已锁定 10 分钟', 429)
      }
      await env.DB.prepare(
        `UPDATE parent_pin SET failed = ? WHERE id = 1`
      ).bind(failed).run()
      return fail(`密码不对，还能试 ${MAX_FAIL - failed} 次`)
    }

    return fail('未知 action')
  } catch (e) {
    return fail('操作失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
