/**
 * 家长解锁的「30 分钟免输窗口」。
 *
 * 校验本身在后端（/api/parent-pin，只存 SHA-256、错 3 次锁 10 分钟）；
 * 这里只管「校验通过后 30 分钟内不再重复输码」。
 * 本机不存码、也不存任何能推出码的信息，孩子翻 localStorage 拿不到东西。
 */
import { verifyParentPin } from './api'

const UNTIL_KEY = 'eng-dict-parent-until'
const WINDOW_MS = 30 * 60 * 1000

function readUntil(): number {
  try { return Number(localStorage.getItem(UNTIL_KEY)) || 0 } catch { return 0 }
}

/** 当前是否处于免输窗口内 */
export function isUnlocked(): boolean {
  return readUntil() > Date.now()
}

/** 校验通过后调用：开启 30 分钟窗口 */
export function markUnlocked() {
  try { localStorage.setItem(UNTIL_KEY, String(Date.now() + WINDOW_MS)) } catch { /* ignore */ }
}

/** 手动上锁（退出窗口） */
export function lockNow() {
  try { localStorage.removeItem(UNTIL_KEY) } catch { /* ignore */ }
}

/** 窗口剩余毫秒 */
export function unlockRemainingMs(): number {
  return Math.max(0, readUntil() - Date.now())
}

/** 校验解锁码（转发后端，成功自动开窗） */
export async function verifyPin(pin: string): Promise<{ ok: boolean; msg: string }> {
  const r = await verifyParentPin(pin)
  if (r.ok) markUnlocked()
  return { ok: r.ok, msg: r.msg }
}
