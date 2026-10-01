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
  mode: 'online' | 'exam' | 'paper' | 'translate'
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

/* ── 出题顺序盐 + 顺序模式（家长控制，云端为准）────────── */

const SALT_KEY = 'eng-dict-shuffle-salt'
const MODE_KEY = 'eng-dict-shuffle-mode'
let _salt: string | null = null
let _mode: 'daily' | 'weekly' | 'manual' | null = null

export type ShuffleModeApi = 'daily' | 'weekly' | 'manual'

function readModeCache(): ShuffleModeApi {
  if (_mode === null) {
    try { _mode = (localStorage.getItem(MODE_KEY) as ShuffleModeApi) || 'daily' } catch { _mode = 'daily' }
  }
  return _mode
}

/**
 * 当前出题顺序模式（云端为准，启动/进页时刷新）。
 *
 * 关键：顺序模式是「家长的全局设置」，不能存在孩子设备的 localStorage
 * progress 里各玩各的 —— 否则家长手机上切到手动档，孩子设备还是每天换，
 * 打印卷（家长设备）和线上卷（孩子设备）顺序就对不上了。
 */
export function currentShuffleMode(): ShuffleModeApi {
  return readModeCache()
}

/** 当前云端盐（先取缓存，启动时 fetchShuffleSalt 刷新） */
export function currentSalt(): string {
  if (_salt === null) {
    try { _salt = localStorage.getItem(SALT_KEY) || '' } catch { _salt = '' }
  }
  return _salt
}

/** 拉取云端盐+模式并缓存（进练习页时都会调一次，失败保持旧值） */
export async function fetchShuffleSalt(): Promise<string> {
  const r = await req<{ salt: string; mode?: string }>('/shuffle')
  if (r && typeof r.salt === 'string') {
    _salt = r.salt
    try { localStorage.setItem(SALT_KEY, r.salt) } catch { /* ignore */ }
  }
  if (r && (r.mode === 'daily' || r.mode === 'weekly' || r.mode === 'manual')) {
    _mode = r.mode
    try { localStorage.setItem(MODE_KEY, r.mode) } catch { /* ignore */ }
  }
  return currentSalt()
}

/** 立即重排：生成新盐存云端。成功返回新盐，失败返回 null */
export async function rotateShuffleSalt(): Promise<string | null> {
  const salt = Math.random().toString(36).slice(2, 10)
  const r = await req<{ salt: string }>('/shuffle', {
    method: 'POST',
    body: JSON.stringify({ salt }),
  })
  if (!r) return null
  _salt = salt
  try { localStorage.setItem(SALT_KEY, salt) } catch { /* ignore */ }
  return salt
}

/** 把顺序模式推到云端（家长切档时调）。成功返回 true */
export async function pushShuffleMode(mode: ShuffleModeApi): Promise<boolean> {
  const r = await req<{ mode: string }>('/shuffle', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
  if (!r) return false
  _mode = mode
  try { localStorage.setItem(MODE_KEY, mode) } catch { /* ignore */ }
  return true
}

/* ── 家长解锁码 ─────────────────────────────────────── */

export interface PinStatusResp { exists: boolean; lockedUntil: number | null }

export async function fetchPinStatus() {
  return req<PinStatusResp>('/parent-pin')
}

export async function verifyParentPin(pin: string): Promise<{ ok: boolean; msg: string; offline?: boolean }> {
  try {
    const r = await fetch(BASE + '/parent-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', pin }),
    })
    const j = await r.json() as { ok: boolean; error?: string }
    if (j.ok) return { ok: true, msg: '' }
    return { ok: false, msg: j.error || '密码不对' }
  } catch {
    return { ok: false, msg: '网络不通，无法校验。请检查网络后重试', offline: true }
  }
}

export async function setParentPin(pin: string, oldPin?: string): Promise<{ ok: boolean; msg: string }> {
  const r = await req('/parent-pin', {
    method: 'POST',
    body: JSON.stringify({ action: 'set', pin, oldPin: oldPin || undefined }),
  })
  return r ? { ok: true, msg: '' } : { ok: false, msg: '设置失败：旧码不对 / 已锁定 / 网络不通' }
}

/* ── 纸质卷照片 ─────────────────────────────────────── */

export interface PhotoItem { key: string; size: number; uploaded: number }

export async function fetchPapers(studentId: string): Promise<PhotoItem[] | null> {
  const r = await req<{ photos: PhotoItem[] }>(`/papers?studentId=${encodeURIComponent(studentId)}`)
  return r ? r.photos : null
}

/** 照片取图地址（走 Functions 代理，不放公开桶） */
export function paperFileUrl(key: string): string {
  return `${BASE}/paper-file?key=${encodeURIComponent(key)}`
}

/* ── 只读分享 ───────────────────────────────────────── */

export interface SharePayload {
  v: 1
  studentName: string
  emoji: string
  title: string
  date: string
  score: number
  sessions: number
  total: number
  right: number
  wrongs: { word: string; cn: string }[]
  photoKeys: string[]
  /** 当天第几次提交这个任务（>1 说明重做了，家长一眼看出刷分） */
  attemptNo?: number
  /** 跟读录音（word/cn 供展示，key 供 /api/record-file 取音频） */
  recordKeys?: { word: string; cn: string; key: string }[]
}

/** 生成分享，成功返回 /s/:id 完整链接 */
export async function createShare(payload: SharePayload): Promise<string | null> {
  const r = await req<{ id: string }>('/share', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  })
  if (!r || !r.id) return null
  return `${location.origin}/s/${r.id}`
}

export async function fetchShare(id: string): Promise<{ payload: SharePayload; createdAt: number } | null> {
  return req<{ payload: SharePayload; createdAt: number }>(`/share?id=${encodeURIComponent(id)}`)
}

/* ── 跟读录音（孩子录、家长在分享页听）──────────────── */

export interface RecItem { key: string; size: number; uploaded: number }

/**
 * 上传一条跟读录音（MediaRecorder 产出的 webm/mp4 音频）。
 * 请求体就是原始音频字节，元数据走 query（不走 JSON/FormData，省一层封装）。
 */
export async function uploadRecording(
  blob: Blob,
  meta: { studentId: string; trackId: string; no: number; word: string; ext: string },
): Promise<string | null> {
  try {
    const q = new URLSearchParams({
      studentId: meta.studentId,
      trackId: meta.trackId,
      no: String(meta.no),
      word: meta.word,
      ext: meta.ext,
    })
    const r = await fetch(`${BASE}/record?${q.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob,
    })
    if (!r.ok) return null
    const j = await r.json() as { ok: boolean; key?: string }
    return j.ok && j.key ? j.key : null
  } catch {
    return null
  }
}

/** 列出孩子的跟读录音（R2） */
export async function fetchRecordings(studentId: string): Promise<RecItem[] | null> {
  const r = await req<{ recordings: RecItem[] }>(`/record?studentId=${encodeURIComponent(studentId)}`)
  return r ? r.recordings : null
}

/** 录音取流地址（走 Functions 代理，不暴露桶） */
export function recordFileUrl(key: string): string {
  return `${BASE}/record-file?key=${encodeURIComponent(key)}`
}
