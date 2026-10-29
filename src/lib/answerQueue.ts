/**
 * 作答上报队列（v8）。
 *
 * 为什么要有这一层：
 *   国内访问 Cloudflare 落在洛杉矶，一次往返实测 1–9 秒、晚上还会整条超时。
 *   原来每答一题立刻 fetch 一次 → 一场 30 题就是 30 次跨境往返：
 *   · 手机上行一直在忙，真正要紧的请求（开新段、拉音频）被挤；
 *   · 弱网下 30 个请求里总有几个挂到 40 秒超时才死，耗电、发热；
 *   · 中途退出时最后几题常常还没发出去，家长的「今天这一场」就少几行。
 *
 * 现在的行为：
 *   · 先落 localStorage，攒满 5 条发一次（一趟写 5 条）；
 *   · 不满 5 条也别一直攥着——6 秒没新题就冲刷；
 *   · 关页面/切后台用 sendBeacon 送最后一程（普通 fetch 会被浏览器掐断）；
 *   · 发送失败就留在队列里，下次做题或网络恢复时一起带上，不会丢。
 *
 * 为什么不做 Service Worker 后台同步：
 *   微信内置浏览器的 background sync 不可靠，弱网下「后台悄悄重试」
 *   不如「下次打开顺手带上」可控。这里用最简单的持久队列 + 机会冲刷。
 */

import { postAnswers, type AnswerPost } from './api'

/** 攒够这么多条就发。5 是折中：3 条太碎，10 条一断网全压在本地 */
export const BATCH = 5
/** 不满一批时，安静多久就发出去 */
const IDLE_MS = 6000
/** 队列上限。超过就丢最旧的——那些是几小时前的题，统计价值已经很低 */
export const QUEUE_MAX = 400

const keyOf = (sid: string) => `eng-dict-ansq:${sid}`

interface Pending extends AnswerPost {
  /** 入队序号：发送成功按它精确删除，不受期间新入队/裁决影响 */
  _q: number
}

let seq = 0
let timer: number | null = null
let sending = false
/** 当前队列所属的身份 */
let currentSid = ''

function read(sid: string): Pending[] {
  try {
    const raw = localStorage.getItem(keyOf(sid))
    if (!raw) return []
    const list = JSON.parse(raw) as Pending[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(sid: string, list: Pending[]) {
  try {
    if (!list.length) localStorage.removeItem(keyOf(sid))
    else localStorage.setItem(keyOf(sid), JSON.stringify(list))
  } catch { /* 配额满：宁可丢队列，也不能让答题崩 */ }
}

/** 超过上限时保留最新的 QUEUE_MAX 条 */
export function capQueue<T>(list: T[]): T[] {
  return list.length <= QUEUE_MAX ? list : list.slice(list.length - QUEUE_MAX)
}

/** 够一批了吗 */
export function shouldFlush(n: number): boolean {
  return n >= BATCH
}

export function pendingCount(sid: string): number {
  return read(sid).length
}

/** 入队一条。不返回值、不抛异常——答题路径上任何网络细节都不该被孩子感知 */
export function enqueueAnswer(a: AnswerPost): void {
  const sid = a.studentId
  currentSid = sid
  seq += 1
  const list = capQueue([...read(sid), { ...a, _q: seq }])
  write(sid, list)
  if (shouldFlush(list.length)) {
    void flushAnswers()
    return
  }
  if (timer == null) {
    timer = window.setTimeout(() => {
      timer = null
      void flushAnswers()
    }, IDLE_MS)
  }
}

/**
 * 冲刷队列。
 * strict=true 用于页面即将关闭：普通 fetch 拿不到结果也照样发出，
 * 成功则按序号删除已发的那几条。
 */
export async function flushAnswers(strict = false): Promise<boolean> {
  if (sending) return false
  const sid = currentSid || guessSid()
  if (!sid) return false
  const list = read(sid)
  if (!list.length) return true

  sending = true
  const rows = list.map(({ _q, ...r }) => r)
  const maxQ = list[list.length - 1]._q
  try {
    const sent = await postAnswers(rows)
    if (sent) {
      // 只删已发出的那批：发送期间可能又有新题进来
      write(sid, read(sid).filter(p => p._q > maxQ))
    } else if (strict && beacon(rows)) {
      write(sid, read(sid).filter(p => p._q > maxQ))
    }
    return sent
  } catch {
    return false
  } finally {
    sending = false
    if (timer != null) { window.clearTimeout(timer); timer = null }
  }
}

/** 关页面时用。beacon 不受页面生命周期影响，但发出去就不知道结果 */
function beacon(rows: AnswerPost[]): boolean {
  try {
    const nav = navigator
    if (!nav.sendBeacon) return false
    const blob = new Blob([JSON.stringify({ answers: rows })], { type: 'application/json' })
    return nav.sendBeacon('/api/answer', blob)
  } catch {
    return false
  }
}

/** 没走过 enqueue（例如页面重开直接冲刷）时，从本地记录里找回身份 */
function guessSid(): string {
  try {
    return localStorage.getItem('eng-dict-active-profile') || ''
  } catch {
    return ''
  }
}

/** 切身份时调用：把上一个身份的队列冲掉，避免串到别人头上 */
export function switchQueue(sid: string): void {
  if (currentSid && currentSid !== sid) void flushAnswers()
  currentSid = sid
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushAnswers(true) })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAnswers(true)
  })
  // 网络恢复时补发：孩子做题中途断网，回到 wifi 就补上
  window.addEventListener('online', () => { void flushAnswers() })
}
