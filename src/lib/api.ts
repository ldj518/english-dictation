/**
 * 前端 API 客户端。
 *
 * 设计原则：后端挂了不能影响学习。
 * 所有上报都 fire-and-forget，失败只记日志，不弹窗打断孩子。
 * 本地 localStorage 始终是「事实来源」，后端是「长期统计的镜像」。
 */

import { todayStr } from './storage'

const BASE = '/api'

/** 是否后端可达（首次探测后缓存） */
let backendAlive: boolean | null = null

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(BASE + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    if (!r.ok) return null
    const j = await r.json() as { ok: boolean } & T
    return j.ok ? j : null
  } catch {
    return null
  }
}

/** 健康检查（结果缓存，避免每次请求都探测） */
export async function checkBackend(): Promise<boolean> {
  if (backendAlive !== null) return backendAlive
  const r = await req<{ db: string }>('/health')
  backendAlive = !!(r && r.db === 'ok')
  return backendAlive
}

export function backendStatus(): boolean | null {
  return backendAlive
}

export interface ReportPayload {
  studentId: string
  trackId: string
  trackLabel: string
  kind: string
  mode: 'online' | 'exam' | 'paper'
  seconds: number
  records: { no: number; word: string; cn: string; input: string; correct: boolean }[]
  photoKey?: string
}

/** 上报一次结果（失败静默） */
export async function reportSession(p: ReportPayload): Promise<boolean> {
  const r = await req<{ sessionId: string }>('/session', {
    method: 'POST',
    body: JSON.stringify(p),
  })
  return !!r
}

/** 同步孩子身份到后端 */
export async function syncStudent(s: { id: string; name: string; emoji: string; color: string }) {
  return req('/students', { method: 'POST', body: JSON.stringify(s) })
}

export interface StatsResp {
  range: string
  today: string
  summary: {
    sessions: number; total: number; right: number; acc: number
    seconds: number; avgScore: number; bestScore: number
    totalDays: number; streak: number
  }
  trend: { day: string; sessions: number; total: number; acc: number; seconds: number }[]
  topWrong: { word: string; cn: string; times: number }[]
  recent: {
    id: string; track_id: string; track_label: string; kind: string; mode: string
    total: number; right_count: number; score: number; seconds: number
    created_at: number; day_key: string; photo_key: string | null
  }[]
}

/** 拉统计 */
export async function fetchStats(studentId: string, range: 'day' | 'week' | 'month', days = 30) {
  return req<StatsResp>(`/stats?studentId=${encodeURIComponent(studentId)}&range=${range}&days=${days}`)
}

export interface OverviewResp {
  today: string
  weekStart: string
  monthStart: string
  byStudent: Record<string, {
    today: StatCell; week: StatCell; month: StatCell
  }>
}
export interface StatCell {
  sessions: number; total: number; right: number; acc: number; seconds: number; avgScore: number
}

/** 家长看板总览 */
export async function fetchOverview() {
  return req<OverviewResp>('/overview')
}

/** 上传纸质卷照片 */
export async function uploadPhoto(file: File, studentId: string): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('studentId', studentId)
    const r = await fetch(BASE + '/upload', { method: 'POST', body: fd })
    if (!r.ok) return null
    const j = await r.json() as { ok: boolean; key?: string }
    return j.ok && j.key ? j.key : null
  } catch {
    return null
  }
}

/** 上报时补齐 dayKey（后端也会算，这里冗余一份便于调试） */
export function currentDayKey(): string {
  return todayStr()
}
