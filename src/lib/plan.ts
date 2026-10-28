/**
 * 今日计划引擎（v4 P2）。
 *
 * 唯一入口 buildPlan()。全站「今天做什么」只许从这里出，别处不许自己算
 * 段数/题数/分钟数——三处各算一次必然对不上（旧版的用时口径就是这么乱的）。
 *
 * 核心翻转（相对旧版）：
 *  旧：固定 5 关，30 分钟是**上限**，做完就结束。
 *  新：30′/60′ 是**下限**，题量按手速倒推，不足用变式重复补满。
 *
 * 档位判定顺序（不能换，命中即停）：
 *   ① 断档 ≥7 天        → restart  本单元重学，新词冻结一周
 *   ② 到期 >45 且断档≥2 → settle   清账期，零新词，每天 26 词
 *   ③ 断档 2–6 天        → recover  恢复期，零新词
 *   ④ 其余               → normal
 */

import { bjAddDays, bjDiffDays, bjDow, bjIsWeekend, bjShort } from './bj'

export type Tier = 'normal' | 'settle' | 'recover' | 'restart' | 'sat' | 'sun'

export type SegKind =
  | 'warm'    // 热身闪卡（不判分）
  | 'learn'   // 新词教学卡（不判分）
  | 'review'  // 到期复习（拼写，判分）
  | 'recall'  // 新词提取（拼写，判分）
  | 'choice'  // 听音选义（判分，两步确认）
  | 'spell'   // 拼写（判分）
  | 'drill'   // 变式重复（同词换题型，填充池）
  | 'paper'   // 纸笔（判分）
  | 'sent'    // 句子拼装（判分）
  | 'test'    // 周测/单元测（判分）
  | 'wrap'    // 结算收尾

export interface PlanSeg {
  k: SegKind
  label: string
  /** 预计分钟 */
  min: number
  /** 涉及词数 */
  words: number
  /** 预计交互次数（题数） */
  q: number
}

export interface StudyConfig {
  /** 工作日有效时间下限（分钟） */
  minMinWork: number
  /** 周末有效时间下限 */
  minMinWeekend: number
  /** 工作日封顶（防磨洋工） */
  maxMinWork: number
  /** 周末封顶 */
  maxMinWeekend: number
  /** 新词上限（引擎还会按遗忘率下调） */
  newWordCap: number
  /** 清账期每天清多少词 */
  settlePerDay: number
  /** 到期词超过这个数且断档≥2 天 → 进清账档 */
  settleThreshold: number
  /** 单题速答阈值（毫秒） */
  fastMs: number
  /** 空闲间隔（毫秒）：两次操作间隔超过这个值，那段时间不算有效学习 */
  idleGapMs: number
  /** 填充池上限（防注水） */
  fillMax: number
  /** 切换日：这之前的天按老口径算打卡，之后按新口径 */
  cutoverDay: string
}

/**
 * 默认配置。
 * 注意 minMinWork 默认 18 而不是 30 —— 分三周爬坡（18 → 24 → 30）由家长后台改，
 * 直接写 30 会让孩子第一天就当惩罚。方案里列了这条风险。
 */
export const DEFAULT_CFG: StudyConfig = {
  minMinWork: 30,
  minMinWeekend: 60,
  maxMinWork: 45,
  maxMinWeekend: 80,
  newWordCap: 6,
  settlePerDay: 26,
  settleThreshold: 45,
  fastMs: 1500,
  idleGapMs: 60000,
  fillMax: 40,
  cutoverDay: '',
}

export interface PlanInput {
  dayKey: string
  /** 距上次有效学习的自然日差；0 = 今天学过/首次使用 */
  gapDays: number
  /** 今天到期词数 */
  dueN: number
  /** 未掌握词数（S < 4） */
  weakN: number
  /** 钉子词数（lapses ≥ 4） */
  nailN: number
  /** 近 7 天遗忘率 0–1 */
  forgetRate: number
  /** 近 7 天单题中位耗时（秒），没有历史用 20 */
  perItemSec: number
  /** 本单元是否还有没学的新词（可教学） */
  hasNew: boolean
  cfg?: Partial<StudyConfig>
}

export interface DayPlan {
  dayKey: string
  tier: Tier
  /** 给人看的一句话档位说明 */
  tierNote: string
  gapDays: number
  /** 有效时间下限 / 封顶（分钟） */
  minMin: number
  maxMin: number
  /** 目标交互次数（由下限和手速倒推） */
  targetQ: number
  /** 今天该清的到期词数（可能小于 dueN，剩下的顺延不丢） */
  dueN: number
  /** 今天该学的新词数 */
  newN: number
  segs: PlanSeg[]
  /** 段预计总时长 */
  estMin: number
  /** 是否周末（决定段结构） */
  weekend: boolean
  dow: number
}

/** 合并配置（家长后台可覆盖任意字段） */
export function mergeCfg(part?: Partial<StudyConfig>): StudyConfig {
  return { ...DEFAULT_CFG, ...(part || {}) }
}

/** 新词额度：看近 7 天遗忘率，不是固定数 */
export function newAllowOf(forgetRate: number, cfg: StudyConfig, hasNew: boolean): number {
  if (!hasNew) return 0
  const cap = Math.max(0, Math.round(cfg.newWordCap))
  if (forgetRate > 0.30) return Math.min(cap, 3)
  if (forgetRate < 0.15) return Math.min(cap, 8)
  return cap
}

/** 判定档位（顺序不能换） */
export function tierOf(gapDays: number, dueN: number, cfg: StudyConfig, dayKey: string): Tier {
  if (gapDays >= 7) return 'restart'
  if (dueN > cfg.settleThreshold && gapDays >= 2) return 'settle'
  if (gapDays >= 2) return 'recover'
  if (bjIsWeekend(dayKey)) return bjDow(dayKey) === 0 ? 'sun' : 'sat'
  return 'normal'
}

const TIER_NOTE: Record<Tier, string> = {
  normal: '正常工作档',
  settle: '清账档：积压太多，先集中清到期词，暂不学新词',
  recover: '恢复档：刚断了几天，先复习不学新词',
  restart: '重启档：断超过一周，本单元重学，新词冻结',
  sat: '周六：清账 + 书写',
  sun: '周日：周测 + 讲卷',
}

/** 段规格表：每段的「人均耗时」用于估算（秒/题） */
const SEG_SEC: Record<SegKind, number> = {
  warm: 8, learn: 25, review: 20, recall: 22, choice: 9,
  spell: 24, drill: 14, paper: 40, sent: 45, test: 16, wrap: 30,
}

function seg(k: SegKind, label: string, words: number, q: number): PlanSeg {
  const min = Math.max(0.5, Math.round(((q * SEG_SEC[k]) / 60) * 10) / 10)
  return { k, label, words, q, min }
}

/**
 * 生成今日计划。纯函数——同样的输入永远得到同样的计划，
 * 所以刷新页面不会换题，也不会因为重算导致「昨天做了 5 段今天变 3 段」。
 */
export function buildPlan(inp: PlanInput): DayPlan {
  const cfg = mergeCfg(inp.cfg)
  const weekend = bjIsWeekend(inp.dayKey)
  const minMin = weekend ? cfg.minMinWeekend : cfg.minMinWork
  const maxMin = weekend ? cfg.maxMinWeekend : cfg.maxMinWork
  const tier = tierOf(inp.gapDays, inp.dueN, cfg, inp.dayKey)

  // 目标交互次数：时间下限 ÷ 单题耗时。手快 → 题多，手慢 → 题少，时间一样。
  const perItem = Math.min(60, Math.max(6, inp.perItemSec || 20))
  const targetQ = Math.round((minMin * 60) / perItem)

  const newN = (tier === 'normal' || tier === 'restart')
    ? newAllowOf(inp.forgetRate, cfg, inp.hasNew)
    : 0

  // 今天能处理多少到期词：按「每词 2 轮（拼写 + 选义）」估容量
  const reviewMin = Math.max(3, Math.round(minMin * 0.42))
  const capByTime = Math.floor((reviewMin * 60) / (perItem * 1.8))
  let dueToday = Math.min(inp.dueN, Math.max(6, capByTime))
  if (tier === 'settle') dueToday = Math.min(inp.dueN, cfg.settlePerDay)
  if (tier === 'restart') dueToday = Math.min(inp.dueN, 12)

  const segs: PlanSeg[] = []

  // ── 热身：昨天错的 3 个词，只做听音看词闪卡，不判分 ──
  if (tier !== 'restart') segs.push(seg('warm', '热身', Math.min(3, inp.dueN), Math.min(3, inp.dueN)))

  if (tier === 'restart') {
    // 本单元重学：教学卡为主，不判分；末尾少量判分确认
    const n = 12
    segs.push(seg('learn', '本单元重学', n, n))
    segs.push(seg('review', '认回这些词', 8, 8))
    segs.push(seg('sent', '两句老句子', 2, 2))
  } else if (tier === 'settle' || tier === 'recover') {
    // 只清到期，零新词。清账要清得多，恢复只清一半
    const half = Math.max(6, Math.floor(dueToday / 2))
    segs.push(seg('review', '到期复习', dueToday, dueToday))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('choice', '听音选义', half, half))
    segs.push(seg('paper', '纸笔 2 词', 2, 2))
    if (tier === 'settle') segs.push(seg('sent', '两句短句', 2, 2))
  } else if (tier === 'sun') {
    // 周日：周测 + 讲卷，零新词
    segs.push(seg('test', '周测 30 题', 30, 30))
    segs.push(seg('review', '到期复习', Math.max(8, Math.floor(dueToday * 0.5)), Math.max(8, Math.floor(dueToday * 0.5))))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('paper', '纸笔 6 词', 6, 6))
    segs.push(seg('sent', '句子 4 句', 4, 4))
    segs.push(seg('drill', '错题归类复盘', 0, 8))
  } else if (tier === 'sat') {
    // 周六：清账 + 书写，零新词
    const n = Math.min(dueToday, 28)
    segs.push(seg('review', '到期复习', n, n))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('paper', '纸笔 8 词', 8, 8))
    segs.push(seg('sent', '句子 4 句', 4, 4))
    segs.push(seg('choice', '混合小测', 20, 20))
  } else {
    // 正常工作日：六段
    segs.push(seg('review', '到期复习', dueToday, dueToday))
    if (newN > 0) {
      segs.push(seg('learn', `新词 ${newN} 个`, newN, newN))
      segs.push(seg('recall', '新词提取', newN, newN))
    }
    segs.push(seg('choice', '听音选义', Math.max(5, Math.min(dueToday, 10)), Math.max(5, Math.min(dueToday, 10))))
    segs.push(seg('spell', '拼写', Math.max(5, Math.min(dueToday, 10)), Math.max(5, Math.min(dueToday, 10))))
    segs.push(seg('sent', '句子 2 句', 2, 2))
  }

  // ── 缺口填充（顺序不能反）：还堆着到期词就先清到期，队列空了才做变式重复 ──
  // 旧逻辑直接补变式重复，结果清账期 182 个词到期、只清 26 个，
  // 剩下 11 分钟却拿去「同词换题型」——放着 156 个到期词不管，纯属浪费。
  let estMin = segs.reduce((s, x) => s + x.min, 0)
  let gap = minMin - estMin - 1   // 留 1 分钟收尾
  const remainingDue = inp.dueN - dueToday
  if (gap > 1 && remainingDue >= 4) {
    const byDue = Math.min(remainingDue, cfg.fillMax, Math.round((gap * 60) / SEG_SEC.review))
    if (byDue >= 3) {
      segs.push(seg('review', `继续清到期 +${byDue} 词`, byDue, byDue))
      dueToday += byDue
      estMin += Math.round(((byDue * SEG_SEC.review) / 60) * 10) / 10
      gap = minMin - estMin - 1
    }
  }
  if (gap > 1) {
    const fillQ = Math.min(cfg.fillMax, Math.round((gap * 60) / SEG_SEC.drill))
    if (fillQ >= 4) {
      segs.push(seg('drill', `变式重复 ${fillQ} 题`, Math.ceil(fillQ / 2), fillQ))
      estMin += Math.round(((fillQ * SEG_SEC.drill) / 60) * 10) / 10
    }
  }

  segs.push(seg('wrap', '结算', 0, 1))
  estMin += segs[segs.length - 1].min

  return {
    dayKey: inp.dayKey,
    tier,
    tierNote: TIER_NOTE[tier],
    gapDays: inp.gapDays,
    minMin, maxMin, targetQ,
    dueN: dueToday,
    newN,
    segs,
    estMin: Math.round(estMin),
    weekend,
    dow: bjDow(inp.dayKey),
  }
}

/**
 * 计划是否达标（双闸门，缺一不算）：
 *  ① 有效时间 ≥ 下限
 *  ② 必做（判分段）全部做完
 * 只满足一个 → 不结算、不给星、不算打卡。
 */
export interface GateInput {
  effSec: number
  plan: DayPlan
  mustDone: number
  mustTotal: number
  peekN: number
  qN: number
}

export interface GateResult {
  timeOk: boolean
  mustOk: boolean
  peekOk: boolean
  done: boolean
  /** 还差多少秒 */
  needSec: number
  /** 还差多少题 */
  needQ: number
  /** 给孩子的说明 */
  note: string
}

export function gateCheck(g: GateInput): GateResult {
  const timeOk = g.effSec >= g.plan.minMin * 60
  const mustOk = g.mustTotal > 0 && g.mustDone >= g.mustTotal
  // 看答案超过 40% 判不过（等于放弃了近一半题）
  const peekOk = g.qN === 0 || g.peekN / Math.max(1, g.qN) <= 0.4
  const needSec = Math.max(0, g.plan.minMin * 60 - g.effSec)
  const needQ = Math.max(0, g.mustTotal - g.mustDone)
  let note = ''
  if (!timeOk && !mustOk) note = `还差 ${Math.ceil(needSec / 60)} 分钟，还有 ${needQ} 题没做完`
  else if (!timeOk) note = `内容做完了，但有效时间还差 ${Math.ceil(needSec / 60)} 分钟`
  else if (!mustOk) note = `时间够了，还有 ${needQ} 题没做完`
  else if (!peekOk) note = '看答案的题太多了，今天不算完成'
  else note = '今天完成'
  return { timeOk, mustOk, peekOk, done: timeOk && mustOk && peekOk, needSec, needQ, note }
}

/** 计划的「必做」题目总数（判分段才算） */
export function mustTotalOf(plan: DayPlan): number {
  return plan.segs
    .filter(s => MUST_SEGS.has(s.k))
    .reduce((n, s) => n + s.q, 0)
}

/**
 * 哪些段算「必做」。
 * drill（变式重复/钉子词）不计入——它是补时间的填充料，把它算进必做会让
 * 「必做 99 题」这种数字出现，孩子一看就崩，也和时间闸门重复约束。
 */
export const MUST_SEGS = new Set<SegKind>(['review', 'recall', 'choice', 'spell', 'sent', 'paper', 'test'])

/** 计划的人类可读摘要（首页一行 + 战报用） */
export function planHeadline(plan: DayPlan): string {
  const d = bjShort(plan.dayKey)
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][plan.dow]
  return `${d} ${w} · ${plan.segs.filter(s => s.k !== 'wrap').length} 段 · 约 ${plan.estMin} 分钟`
}

/** 清账期还剩几天（首日 182 词 → 7 天） */
export function settleDaysLeft(dueN: number, cfg: StudyConfig): number {
  return Math.max(1, Math.ceil(dueN / Math.max(1, cfg.settlePerDay)))
}
