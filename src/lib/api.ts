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
  mode: 'online' | 'exam' | 'paper' | 'translate' | 'spell' | 'forms'
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

export interface StudentRow { id: string; name: string; emoji: string; color: string }

/** 拉全部孩子身份（云端为准做合并——改名后别的设备才能看到） */
export async function fetchStudents(): Promise<StudentRow[]> {
  const r = await req<{ students: StudentRow[] }>('/students')
  return r?.students || []
}

/** 拉某孩子的进度快照（云端没有返回 null） */
export async function fetchProgressSnapshot(studentId: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${BASE}/progress?studentId=${encodeURIComponent(studentId)}`)
    if (!r.ok) return null
    const j = await r.json() as { ok: boolean; data?: unknown }
    return j.ok ? (j.data ?? null) : null
  } catch {
    return null
  }
}

/** 推送进度快照（fire-and-forget，失败静默） */
export async function pushProgressSnapshot(studentId: string, data: unknown): Promise<boolean> {
  const r = await req('/progress', {
    method: 'POST',
    body: JSON.stringify({ studentId, data }),
  })
  return !!r
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

/* ═══════════ 词库册子（v2.5）═══════════ */

export interface BookMeta { id: string; name: string; count: number }
export interface BooksResp {
  books: BookMeta[]
  active: string
  dailyWords: number
}

const BOOKS_KEY = 'eng-dict-books'
let _books: BooksResp | null = null

function cacheBooks(b: BooksResp) {
  _books = b
  try { localStorage.setItem(BOOKS_KEY, JSON.stringify(b)) } catch { /* ignore */ }
}

function readBooksCache(): BooksResp | null {
  if (_books) return _books
  try {
    const raw = localStorage.getItem(BOOKS_KEY)
    if (raw) _books = JSON.parse(raw) as BooksResp
  } catch { /* ignore */ }
  return _books
}

/** 拉取册子列表 + 激活册子 + 每日词量（云端为准，离线用缓存） */
export async function fetchWordbooks(): Promise<BooksResp | null> {
  const r = await req<BooksResp>('/wordbooks')
  if (r && Array.isArray(r.books)) {
    const b: BooksResp = {
      books: r.books,
      active: r.active || 'builtin7a',
      dailyWords: r.dailyWords || 10,
    }
    cacheBooks(b)
    return b
  }
  return readBooksCache()
}

/** 当前缓存的册子状态（同步，进页面立即可用） */
export function currentBooks(): BooksResp | null {
  return readBooksCache()
}

/** 切换激活册子。成功返回 true */
export async function pushActiveBook(id: string): Promise<boolean> {
  const r = await req<{ active: string }>('/wordbooks', {
    method: 'POST',
    body: JSON.stringify({ action: 'setActive', id }),
  })
  if (r && _books) { _books.active = id; cacheBooks(_books) }
  return !!r
}

/** 设置每日新词数。成功返回 true */
export async function pushDailyWords(n: number): Promise<boolean> {
  const r = await req<{ dailyWords: number }>('/wordbooks', {
    method: 'POST',
    body: JSON.stringify({ action: 'setDailyWords', n }),
  })
  if (r && _books) { _books.dailyWords = n; cacheBooks(_books) }
  return !!r
}

/** 创建自定义册子（粘贴词单）。成功返回 {id,count,skipped}，业务错误返回 {error}（后端文案直透），网络不通返回 null */
export async function createWordbook(name: string, text: string): Promise<{ id: string; count: number; skipped: number } | { error: string } | null> {
  try {
    // 不走 req：400 也带 {ok:false,error}，要把「有效词条太少」这类原因给家长看
    const r = await fetch(BASE + '/wordbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name, text }),
    })
    const j = await r.json().catch(() => null) as
      | { ok?: boolean; id?: string; count?: number; skipped?: number; error?: string }
      | null
    if (!j) return null
    if (j.ok && j.id) {
      // 刷新缓存里的册子列表（简单做法：重拉）
      void fetchWordbooks()
      return { id: j.id, count: j.count || 0, skipped: j.skipped || 0 }
    }
    return { error: j.error || '创建失败，稍后再试' }
  } catch {
    return null
  }
}

/** 删除自定义册子。成功返回 true */
export async function deleteWordbook(id: string): Promise<boolean> {
  const r = await req('/wordbooks', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', id }),
  })
  if (r) void fetchWordbooks()
  return !!r
}

/* ── 家长管控规则（v2.8）：云端为准，所有设备生效 ───────────────── */

export interface ParentRules {
  kbBuiltIn?: boolean
  shuffle?: boolean
  syncPaper?: boolean
  prepMode?: 'recommended' | 'force' | 'off'
  parentMessage?: string
}

/** 拉家长规则（离线/未设置返回 {}，调用方用本地 settings 兜底） */
export async function fetchParentRules(): Promise<ParentRules> {
  const r = await req<{ rules: ParentRules }>('/rules')
  return r?.rules || {}
}

/** 保存家长规则（家长中心 PIN 门禁后调用） */
export async function pushParentRules(rules: ParentRules): Promise<boolean> {
  const r = await req('/rules', { method: 'POST', body: JSON.stringify(rules) })
  return !!r
}
