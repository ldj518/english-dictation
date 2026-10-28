/**
 * 有效学习时间计时器（v4 P3）。
 *
 * 这是「30 分钟下限」唯一的地基。要求：**打开放着不管，30 分钟永远到不了。**
 *
 * 规则：
 *  - 只累加「相邻两次操作间隔 ≤ idleGapMs」的时长
 *  - 间隔超过阈值的部分，整段记成空闲（idle），不进有效时间
 *  - 页面切到后台立刻结算当前间隔，回来重新计
 *
 * 口径为什么要分开存：家长后台要能看「有效 / 挂机」比。只存总时长的话，
 * 挂机 20 分钟和真学 20 分钟长得一样，什么都查不出来。
 */

export interface TimerSnap {
  /** 有效秒数 */
  effSec: number
  /** 空闲秒数 */
  idleSec: number
  /** 墙钟总秒数（从 start 起算） */
  wallSec: number
  /** 从开始到现在的总交互次数 */
  taps: number
  /** 最近一次操作距今秒数 */
  sinceLastTap: number
}

export class EffTimer {
  private startAt: number
  private lastAt: number
  private idleGapMs: number
  private effMs = 0
  private idleMs = 0
  private taps = 0
  private paused = false

  /**
   * @param idleGapMs 空闲判定阈值
   * @param startAt   起算时刻
   * @param init      当天已累计的时间（中途退出再进来时接着算，不清零）
   */
  constructor(idleGapMs = 60000, startAt = Date.now(), init?: { effSec?: number; idleSec?: number }) {
    this.idleGapMs = idleGapMs
    this.startAt = startAt
    this.lastAt = startAt
    // 当天做过一半就退出（吃饭/上厕所），再进来必须接着算，
    // 不能从 0 开始——否则孩子得一口气坐满 30 分钟，中途不敢停。
    this.effMs = Math.max(0, Math.round((init?.effSec || 0) * 1000))
    this.idleMs = Math.max(0, Math.round((init?.idleSec || 0) * 1000))
  }

  /** 每次真实操作调一次（点按钮、输入、选择、提交） */
  tap(now = Date.now()) {
    if (this.paused) { this.paused = false; this.lastAt = now }
    this.settle(now)
    this.taps += 1
  }

  /** 把 lastAt → now 这段结算掉 */
  private settle(now: number) {
    const dt = now - this.lastAt
    if (dt <= 0) return
    if (dt <= this.idleGapMs) {
      this.effMs += dt
    } else {
      // 超过阈值：阈值内算有效（人还在，只是慢），超出部分算空闲
      this.effMs += this.idleGapMs
      this.idleMs += dt - this.idleGapMs
    }
    this.lastAt = now
  }

  /** 分段/结算时把当前这一段落袋（不增加 tap 数） */
  flush(now = Date.now()) {
    this.settle(now)
  }

  /** 切后台：把当前间隔按空闲结掉，回来重新起算 */
  pause(now = Date.now()) {
    this.settle(now)
    this.paused = true
    this.lastAt = now
  }

  resume(now = Date.now()) {
    this.lastAt = now
    this.paused = false
  }

  /** 当前快照（不改变状态，可随时读来渲染） */
  snap(now = Date.now()): TimerSnap {
    const dt = Math.max(0, now - this.lastAt)
    const eff = this.effMs + Math.min(dt, this.idleGapMs)
    return {
      effSec: Math.round(eff / 1000),
      idleSec: Math.round((this.idleMs + Math.max(0, dt - this.idleGapMs)) / 1000),
      wallSec: Math.round((now - this.startAt) / 1000),
      taps: this.taps,
      sinceLastTap: Math.round(dt / 1000),
    }
  }

  /** 单题耗时（毫秒）——速答判定用 */
  static lapMs(from: number, to = Date.now()): number {
    return Math.max(0, to - from)
  }
}

/**
 * 从历史记录估算单题中位耗时（秒）。
 * 没有记录时给 20 秒——这是「中文提示 + 打字 8-12 个字母」的正常速度。
 */
export function medianPerItemSec(historyTimes: number[]): number {
  const v = historyTimes.filter(x => x > 0 && x < 300).sort((a, b) => a - b)
  if (!v.length) return 20
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}
