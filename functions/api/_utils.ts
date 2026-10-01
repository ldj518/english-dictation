/**
 * Cloudflare Pages Functions —— 英语听写后端 API。
 *
 * 路由（文件路径即路由）：
 *   POST /api/session      上报一次听写/考试/纸质批改的结果
 *   GET  /api/stats        按 day/week/month 聚合统计
 *   GET  /api/sessions     历史记录列表
 *   GET  /api/overview     总览（两个孩子的今日/本周/本月）
 *   POST /api/student      创建/更新孩子身份
 *   GET  /api/students     孩子列表
 *   POST /api/upload       上传纸质卷照片到 R2
 *   GET  /api/health       健康检查
 *
 * 共享工具函数集中在这里，各路由 import。
 */

export interface Env {
  DB: D1Database
  BUCKET?: R2Bucket
  /** 家长查看令牌（可选，配了才校验） */
  PARENT_TOKEN?: string
}

/** CORS：允许同源 + 本地开发 */
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Parent-Token',
  'Access-Control-Max-Age': '86400',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}

export function ok(data: unknown) {
  return json({ ok: true, ...(typeof data === 'object' && data !== null ? data : { data }) })
}

export function fail(msg: string, status = 400) {
  return json({ ok: false, error: msg }, status)
}

/** 处理 OPTIONS 预检 */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

/** yyyy-mm-dd（按北京时间 UTC+8 算，避免跨零点统计错） */
export function dayKey(ts = Date.now()): string {
  const d = new Date(ts + 8 * 3600 * 1000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`
}

/** ISO 周：yyyy-Www */
export function weekKey(ts = Date.now()): string {
  const d = new Date(ts + 8 * 3600 * 1000)
  const day = (d.getUTCDay() + 6) % 7          // 周一=0
  d.setUTCDate(d.getUTCDate() - day)            // 回到本周一
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`
}

/** 月：yyyy-mm */
export function monthKey(ts = Date.now()): string {
  const d = new Date(ts + 8 * 3600 * 1000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}`
}

/** 生成短 id */
export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
