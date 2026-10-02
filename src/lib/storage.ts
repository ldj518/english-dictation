import type { Progress, WrongWord, Profile } from '../types'

/** 遗忘曲线间隔（天）：1 / 2 / 4 / 7 / 15 / 30 */
export const REVIEW_STAGES = [1, 2, 4, 7, 15, 30]

/** 旧版单用户存储键（用于迁移） */
const LEGACY_KEY = 'eng-dict-v1'
/** 当前活跃的孩子身份 */
const PROFILE_KEY = 'eng-dict-active-profile'
/** 身份列表 */
const PROFILES_KEY = 'eng-dict-profiles'

/** 每个身份的进度存储键 */
export function progressKey(profileId: string): string {
  return `eng-dict-v1:${profileId}`
}

/** 默认身份（首次使用） */
export const DEFAULT_PROFILES: Profile[] = [
  { id: 'p1', name: '哥哥', emoji: '🦁', color: '#e8590c' },
  { id: 'p2', name: '弟弟', emoji: '🐯', color: '#1c7ed6' },
]

/* ── 身份管理 ───────────────────────────────────────── */

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) {
      const list = JSON.parse(raw) as Profile[]
      if (Array.isArray(list) && list.length) return list
    }
  } catch { /* ignore */ }
  // 首次：写入默认身份，并把旧的单用户数据迁移给第一个身份
  saveProfiles(DEFAULT_PROFILES)
  migrateLegacy(DEFAULT_PROFILES[0].id)
  return DEFAULT_PROFILES
}

export function saveProfiles(list: Profile[]) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

export function activeProfileId(): string {
  try {
    const id = localStorage.getItem(PROFILE_KEY)
    if (id) return id
  } catch { /* ignore */ }
  return DEFAULT_PROFILES[0].id
}

export function setActiveProfileId(id: string) {
  try { localStorage.setItem(PROFILE_KEY, id) } catch { /* ignore */ }
}

/** 把旧版单用户数据迁移到指定身份（仅在目标尚无数据时） */
function migrateLegacy(toProfileId: string) {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!legacy) return
    const target = progressKey(toProfileId)
    if (localStorage.getItem(target)) return
    localStorage.setItem(target, legacy)
    localStorage.removeItem(LEGACY_KEY)
  } catch { /* ignore */ }
}

/* ── 进度读写（按身份隔离）─────────────────────────── */

export const defaultProgress = (): Progress => ({
  best: {},
  attempts: {},
  wrong: {},
  points: 0,
  streakDays: 0,
  lastDay: '',
  badges: {},
  totalAnswers: 0,
  totalRight: 0,
  history: [],
  minutes: {},
  planDone: 0,
  learned: {},
  review: {},
  reviewDone: {},
  planLog: {},
  trioDone: {},
  passed: {},
  settings: { rate: 1, repeat: 2, gap: 4, voiceMode: 'normal', shuffle: true, shuffleMode: 'daily', kbBuiltIn: true, syncPaper: true },
})

export function load(profileId = activeProfileId()): Progress {
  try {
    const raw = localStorage.getItem(progressKey(profileId))
    if (!raw) return defaultProgress()
    const p = JSON.parse(raw) as Progress
    return { ...defaultProgress(), ...p, settings: { ...defaultProgress().settings, ...(p.settings || {}) } }
  } catch {
    return defaultProgress()
  }
}

export function save(p: Progress, profileId = activeProfileId()) {
  try {
    localStorage.setItem(progressKey(profileId), JSON.stringify(p))
  } catch { /* 存储满/隐私模式，忽略 */ }
}

export function reset(profileId = activeProfileId()) {
  localStorage.removeItem(progressKey(profileId))
}

/* ── 设备主人标记（v3.3）：这台设备「今天谁学」选的人 ── */
const OWNER_KEY = 'eng-dict-device-owner'

export function deviceOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY) } catch { return null }
}

export function setDeviceOwner(id: string) {
  try { localStorage.setItem(OWNER_KEY, id) } catch { /* ignore */ }
}

/* ── 家长查看回切标记（v3.3.2）──────────────────────────
   家长在家长中心切到别的孩子看板时，立即记录「进页时是谁」。
   正常退出家长中心会自动切回并清标记；若中途直接关掉浏览器
   （unmount 来不及跑），下次启动在这里兜底恢复——防止设备归属
   残留在被查看的孩子身上。 */
const REVERT_KEY = 'eng-dict-revert-owner'

/** 家长中心切人查看的瞬间调用：记下该切回谁 */
export function markRevertOwner(id: string) {
  try { localStorage.setItem(REVERT_KEY, id) } catch { /* ignore */ }
}

/** 正常切回后调用：清掉标记 */
export function clearRevertOwner() {
  try { localStorage.removeItem(REVERT_KEY) } catch { /* ignore */ }
}

/** 启动兜底：发现回切标记且目标身份有效 → 恢复归属并清标记 */
export function consumeRevertOwner(): void {
  try {
    const id = localStorage.getItem(REVERT_KEY)
    if (!id) return
    localStorage.removeItem(REVERT_KEY)
    if (!loadProfiles().some(p => p.id === id)) return
    setDeviceOwner(id)
    setActiveProfileId(id)
  } catch { /* ignore */ }
}
// 模块加载即消费：store 初始化读 activeProfileId()、选人门读 deviceOwner() 之前生效
consumeRevertOwner()

export function todayStr(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

/** 本周一的日期串（yyyy-mm-dd，本地时区）。「每周换顺序」用它当盐 */
export function weekStartStr(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (x.getDay() + 6) % 7   // 周一=0
  x.setDate(x.getDate() - day)
  return todayStr(x)
}

const DAY = 86400000

/** 把一个词加入错词本（或提升错误次数、重置复习阶段） */
export function addWrong(p: Progress, word: string, cn: string): Progress {
  const now = Date.now()
  const cur: WrongWord = p.wrong[word] || {
    word, cn, count: 0, streak: 0, addedAt: now, lastAt: now, dueAt: now, stage: 0,
  }
  cur.count += 1
  cur.streak = 0
  cur.stage = 0
  cur.lastAt = now
  cur.dueAt = now + REVIEW_STAGES[0] * DAY
  p.wrong[word] = cur
  return p
}

/** 复习答对：推进阶段；满级后移出错词本 */
export function advanceWrong(p: Progress, word: string): { p: Progress; graduated: boolean } {
  const cur = p.wrong[word]
  if (!cur) return { p, graduated: false }
  cur.streak += 1
  cur.lastAt = Date.now()
  if (cur.stage >= REVIEW_STAGES.length - 1) {
    delete p.wrong[word]
    return { p, graduated: true }
  }
  cur.stage += 1
  cur.dueAt = Date.now() + REVIEW_STAGES[cur.stage] * DAY
  return { p, graduated: false }
}

/** 取今天该复习的错词 */
export function dueWrongWords(p: Progress): WrongWord[] {
  const now = Date.now()
  return Object.values(p.wrong)
    .filter(w => w.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
}

/** 打卡：返回是否新的一天 */
export function checkIn(p: Progress): boolean {
  const t = todayStr()
  if (p.lastDay === t) return false
  const y = todayStr(new Date(Date.now() - DAY))
  p.streakDays = p.lastDay === y ? p.streakDays + 1 : 1
  p.lastDay = t
  return true
}

/** 判断答案是否正确（宽松判分：忽略大小写、首尾空格、多余空格、常见标点） */
export function judge(input: string, answer: string): boolean {
  const norm = (s: string) =>
    s.trim().toLowerCase()
      .replace(/[.,!?;:'"]/g, '')
      .replace(/\s+/g, ' ')
  return norm(input) === norm(answer) && norm(input).length > 0
}
