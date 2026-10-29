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
 *   ① 断档 ≥7 天   → restart  先重学旧词，新词冻结一周
 *   ② 到期 >45     → settle   清账期，零新词，每天 26 词（**不看断档**，见 tierOf 注释）
 *   ③ 断档 2–6 天  → recover  恢复期，零新词
 *   ④ 其余          → normal
 */

import { bjAddDays, bjDiffDays, bjDow, bjIsWeekend, bjShort } from './bj'
import type { Progress } from '../types'

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
  | 'sent'    // 句子拼装（意群块，判分）
  | 'mean'    // 句意选择（整句英文四选一，判分）
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
  /** 工作日目标时长（分钟）：只用来**排版题量**，不再当完成闸门 */
  minMinWork: number
  /** 周末目标时长 */
  minMinWeekend: number
  /** 工作日封顶（防磨洋工） */
  maxMinWork: number
  /** 周末封顶 */
  maxMinWeekend: number
  /**
   * 配置版本号。云端快照里存着旧版 studyCfg，
   * 旧版本号一律丢弃、回落到当前默认值——否则改完默认值，
   * 孩子浏览器里那份老三十分钟的配置会把新值盖回来。
   */
  cfgRev?: number
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
  /** 是否启用三周爬坡（18→24→30）。家长想一步到位就关掉 */
  rampOn: boolean
  /** 切换日：这之前的天按老口径算打卡，之后按新口径 */
  cutoverDay: string
}

/**
 * 默认配置（2026-10-29 按真实数据重定）。
 *
 * 旧值 30 / 60 / 45 / 80 是从「家长希望他每天学半小时」推出来的，
 * 但 p1 的 19 天真实记录是：工作日 2.5–10 分钟、周末 28–35 分钟、秒/题中位 12–14 秒。
 * 拿 30 分钟当闸门的结果是：他每天都只坐 10 分钟，于是**每天都被判未完成**，
 * 断档天数一路涨，档位越滑越重（恢复档→清账档），题量反而越堆越大。
 * 现在的口径：
 *   - minMin 只是「排多少题」的目标，不是完成条件（见 gateCheck）；
 *   - 完成 = 必做题做完 + 看答案不超 40%；
 *   - maxMin 才是有牙齿的那条：到点强制收尾。
 * 爬坡（18→24→30）一并关掉——基线本来就该是他做到的 13 分钟，不是三周后爬到 30。
 */
export const DEFAULT_CFG: StudyConfig = {
  cfgRev: 2,
  minMinWork: 13,
  minMinWeekend: 30,
  maxMinWork: 30,
  maxMinWeekend: 50,
  newWordCap: 6,
  // 清账期每天 20 词：按 13 分钟的口径，26 词会让预计时长撑到 18 分钟，
  // 孩子看到「约 18 分钟」就懒得开始。20 词排出来约 15 分钟，和真实手速对得上。
  settlePerDay: 20,
  settleThreshold: 45,
  fastMs: 1500,
  idleGapMs: 60000,
  fillMax: 40,
  rampOn: false,
  cutoverDay: '',
}

/** 爬坡三周的下限（分钟）。默认 cfg.rampOn=false，这套只在家长手动打开时生效。 */
export const RAMP_MIN = [18, 24, 30] as const

/** 第几周（0 起），按 rampStart 到今天的自然日差 ÷ 7，最多 2 周 */
export function rampWeekOf(rampStart: string, dayKey: string): number {
  if (!rampStart) return 2
  const d = bjDiffDays(dayKey, rampStart)
  if (d <= 0) return 0
  return Math.min(2, Math.floor(d / 7))
}

/** 爬坡后的下限：取「目标」和「本周值」的小者，目标低于 18 就按目标 */
export function rampMinOf(target: number, week: number): number {
  const w = RAMP_MIN[Math.max(0, Math.min(2, Math.round(week)))]
  return Math.min(target, w)
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
  /** 爬坡第几周（0/1/2）。不传 = 不爬坡，按下限原值 */
  rampWeek?: number
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
  /** 本次用的单题耗时（秒），实测值或 20 兜底 */
  perItemSec: number
  /** 爬坡第几周（0/1/2）；不爬坡时为 2 */
  rampWeek: number
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

/**
 * 旧版配置作废。
 *
 * 云端快照和 localStorage 里存着 v1 的 studyCfg（30/60/45/80、rampOn=true）。
 * 那份配置会在同步时盖回本地，把新默认值顶掉——死锁会原样复活。
 * 所以加载时检查 cfgRev：版本对不上就整份丢掉，回落到当前默认值。
 * 家长之后在后台改的参数都会带 cfgRev（见 setStudyCfg），不会被误伤。
 */
export function migrateStudyCfg(sc?: Partial<StudyConfig>): Partial<StudyConfig> | undefined {
  if (!sc) return undefined
  const rev = Number(sc.cfgRev || 0)
  if (rev === DEFAULT_CFG.cfgRev) return sc
  // 只有确实带了旧值的才丢；空对象留着无害
  return Object.keys(sc).length ? undefined : sc
}

/** 新词额度：看近 7 天遗忘率，不是固定数 */
export function newAllowOf(forgetRate: number, cfg: StudyConfig, hasNew: boolean): number {
  if (!hasNew) return 0
  const cap = Math.max(0, Math.round(cfg.newWordCap))
  if (forgetRate > 0.30) return Math.min(cap, 3)
  if (forgetRate < 0.15) return Math.min(cap, 8)
  return cap
}

/**
 * 判定档位（顺序不能换）。
 *
 * 清账档**不再要求断档 ≥2 天**：原来写 `dueN > 45 且 gapDays >= 2`，结果是
 * 上线首日清账、第 2 天孩子昨天刚学过（gap=1）就落回 normal，新词额度恢复，
 * 150 个到期词还没清完又开始欠新债。到期堆着就是清账，清到 45 以下自动退出。
 *
 * 断档阈值也放宽了（2026-10-29）：原来 2 天就恢复档、7 天就重启档。
 * 但 p1 的实际节奏是一周里有 1–2 天不开（10-19~10-25 缺 23 号），
 * 断两天在他是常态，不是事故。所以：
 *   - 断 3 天以上才算「恢复档」
 *   - 断 10 天以上才算「重启档」（重启档要冻结新词、重学 12 个旧词，代价很大）
 */
export function tierOf(gapDays: number, dueN: number, cfg: StudyConfig, dayKey: string): Tier {
  if (gapDays >= 10) return 'restart'
  if (dueN > cfg.settleThreshold) return 'settle'
  if (gapDays >= 3) return 'recover'
  if (bjIsWeekend(dayKey)) return bjDow(dayKey) === 0 ? 'sun' : 'sat'
  return 'normal'
}

const TIER_NOTE: Record<Tier, string> = {
  normal: '正常工作档',
  settle: '清账档：积压太多，先集中清到期词，暂不学新词',
  recover: '恢复档：刚断了几天，先复习不学新词',
  restart: '重启档：断超过一周，先重学旧词，新词冻结',
  sat: '周六：清账 + 书写',
  sun: '周日：周测 + 讲卷',
}

/** 段规格表：每段的「人均耗时」用于估算（秒/题） */
const SEG_SEC: Record<SegKind, number> = {
  warm: 8, learn: 25, review: 20, recall: 22, choice: 9,
  spell: 24, drill: 14, paper: 40, sent: 45, mean: 30, test: 16, wrap: 30,
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
  const baseMin = weekend ? cfg.minMinWeekend : cfg.minMinWork
  // 三周爬坡只作用在工作日：周末本来就有 60 分钟，不存在「突然翻倍」的落差
  const minMin = (!weekend && cfg.rampOn && typeof inp.rampWeek === 'number')
    ? rampMinOf(baseMin, inp.rampWeek)
    : baseMin
  const maxMin = weekend ? cfg.maxMinWeekend : cfg.maxMinWork
  const tier = tierOf(inp.gapDays, inp.dueN, cfg, inp.dayKey)

  // 目标交互次数：时间下限 ÷ 单题耗时。手快 → 题多，手慢 → 题少，时间一样。
  const perItem = Math.min(60, Math.max(6, inp.perItemSec || 20))
  const targetQ = Math.round((minMin * 60) / perItem)

  // 重启档不给新词：文案写的是「新词冻结」，代码也得真冻。
  // 之前把 restart 也算进 newAllowOf，结果「本单元重学 12 题」里塞的是 6 个
  // 从没见过的词（教学卡池 fresh 优先），标签和行为对不上：
  // 断档一周回来的孩子该先补旧的，不该一边说冻结一边上新课。
  const newN = tier === 'normal' ? newAllowOf(inp.forgetRate, cfg, inp.hasNew) : 0

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
    // 先重学旧词：教学卡为主，不判分；末尾少量判分确认
    // 教的和考的是同一批到期词（qbank 里 taught 传给下一段），所以标签写清楚，
    // 别再说「本单元」——到期词是按风险排的，跨单元，本来就不是「本单元」。
    const n = 12
    segs.push(seg('learn', '重学 12 个旧词', n, n))
    segs.push(seg('review', '拼出刚教的 8 个', 8, 8))
    // 重启档只拼已经学过词的老句子，不引新句
    segs.push(seg('sent', '拼两句老句子', 2, 2))
  } else if (tier === 'settle' || tier === 'recover') {
    // 只清到期，零新词。清账要清得多，恢复只清一半
    const half = Math.max(6, Math.floor(dueToday / 2))
    segs.push(seg('review', '到期复习', dueToday, dueToday))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('choice', '听音选义', half, half))
    segs.push(seg('paper', '纸笔 2 词', 2, 2))
    // 积压期只读不出：读懂整句不占工作记忆，拼装会拖慢清账节奏
    if (tier === 'settle') segs.push(seg('mean', '读懂两句', 2, 2))
  } else if (tier === 'sun') {
    // 周日：周测 + 讲卷，零新词
    segs.push(seg('test', '周测 30 题', 30, 30))
    segs.push(seg('review', '到期复习', Math.max(8, Math.floor(dueToday * 0.5)), Math.max(8, Math.floor(dueToday * 0.5))))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('paper', '纸笔 6 词', 6, 6))
    segs.push(seg('mean', '读懂 4 句', 4, 4))
    segs.push(seg('sent', '拼出 4 句', 4, 4))
    segs.push(seg('drill', '错题归类复盘', 0, 8))
  } else if (tier === 'sat') {
    // 周六：清账 + 书写，零新词
    const n = Math.min(dueToday, 28)
    segs.push(seg('review', '到期复习', n, n))
    if (inp.nailN > 0) segs.push(seg('drill', `钉子词 ${Math.min(8, inp.nailN)} 个`, Math.min(8, inp.nailN), Math.min(8, inp.nailN) * 2))
    segs.push(seg('paper', '纸笔 8 词', 8, 8))
    segs.push(seg('mean', '读懂 4 句', 4, 4))
    segs.push(seg('sent', '拼出 4 句', 4, 4))
    segs.push(seg('choice', '混合小测', 20, 20))
  } else {
    // 正常工作日：先认词，再读整句，最后拼句。
    // 顺序不能反：句意选择会显示整句英文，排在拼写前面就等于把答案给出去。
    segs.push(seg('review', '到期复习', dueToday, dueToday))
    if (newN > 0) {
      segs.push(seg('learn', `新词 ${newN} 个`, newN, newN))
      segs.push(seg('recall', '新词提取', newN, newN))
    }
    segs.push(seg('choice', '听音选义', Math.max(5, Math.min(dueToday, 10)), Math.max(5, Math.min(dueToday, 10))))
    segs.push(seg('spell', '拼写', Math.max(5, Math.min(dueToday, 10)), Math.max(5, Math.min(dueToday, 10))))
    segs.push(seg('mean', '读懂 3 句', 3, 3))
    segs.push(seg('sent', '拼出 3 句', 3, 3))
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
    perItemSec: perItem,
    rampWeek: typeof inp.rampWeek === 'number' ? inp.rampWeek : 2,
    dueN: dueToday,
    newN,
    segs,
    estMin: Math.round(estMin),
    weekend,
    dow: bjDow(inp.dayKey),
  }
}

/**
 * 上次真正学过的一天，三个来源取最晚者：
 *  ① lastDay          —— 老页面（听写/单元测）打卡
 *  ② dayLog[k].done   —— 每日流水线结算
 *  ③ lastActiveDay    —— 云端 sessions 表里最后一条练习记录（服务端算好带回）
 *
 * 只看 lastDay 会严重误判，线上踩过两次：
 *  · 孩子 10-07 之后改用「每日计划」，那条线不写 lastDay → lastDay 冻在 10-07
 *  · 于是 10-29 被判成「断档 22 天」→ 天天重启档，新词/听音选义/句意选择全被压掉
 * 实际孩子 10-25 还在学（sessions 有 4 条记录），真实断档只有 4 天。
 * 所以 ③ 必须进判定——它是唯一能覆盖「每日计划」这条线的证据。
 */
export function lastStudyDay(p: Progress, dayKey: string): string {
  const cands: string[] = []
  if (p.lastDay) cands.push(p.lastDay)
  if (p.lastActiveDay) cands.push(p.lastActiveDay)
  for (const [k, l] of Object.entries(p.dayLog || {})) {
    if (!l?.done) continue
    cands.push(k)
  }
  // 时钟错乱的未来日不认（否则会算出负断档）
  return cands.filter(d => bjDiffDays(dayKey, d) >= 0).sort().pop() || ''
}

/** 距上次真正学习的天数；从没学过返回 0（首次使用不算断档） */
export function gapDaysOf(p: Progress, dayKey: string): number {
  const last = lastStudyDay(p, dayKey)
  return last ? Math.max(0, bjDiffDays(dayKey, last)) : 0
}

/**
 * 计划是否达标（2026-10-29 起只剩两条真闸门）：
 *  ① 必做（判分段）全部做完
 *  ② 看答案的题不超过 40%
 * 有效时长不计入判定——它只决定今天排多少题。详见 gateCheck。
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
  /** 是否达到目标时长。**只用于展示进度，不再是完成条件** */
  timeOk: boolean
  mustOk: boolean
  peekOk: boolean
  done: boolean
  /** 距目标时长还差多少秒（展示用） */
  needSec: number
  /** 还差多少题 */
  needQ: number
  /** 给孩子的说明 */
  note: string
}

/**
 * 当日完成判定。
 *
 * ⚠️ 2026-10-29 拆除时间闸门。原来要求「有效时间满 minMin **且** 必做全做完」，
 * 而 p1 的真实记录是每天只坐 2.5–10 分钟（19 天里没有一天到 18 分钟）。
 * 双硬闸的后果是死锁：
 *   做 10 分钟 → 判未完成 → dayLog.done=false → 断档天数上涨
 *   → 进恢复/清账档 → 题量变大 → 更做不完 → 干脆不打开
 * 现在只留两个真闸门：必做题做完 + 看答案不超过 40%。
 * 时间降级成「今天排了多少题」的排版参数，做快了就早点收工，不额外加量。
 */
export function gateCheck(g: GateInput): GateResult {
  const mustOk = g.mustTotal > 0 && g.mustDone >= g.mustTotal
  // 看答案超过 40% 判不过（等于放弃了近一半题）
  const peekOk = g.qN === 0 || g.peekN / Math.max(1, g.qN) <= 0.4
  const timeOk = g.effSec >= g.plan.minMin * 60
  const needSec = Math.max(0, g.plan.minMin * 60 - g.effSec)
  const needQ = Math.max(0, g.mustTotal - g.mustDone)
  let note = ''
  if (mustOk && peekOk) note = '今天完成'
  else if (!mustOk && !peekOk) note = `还有 ${needQ} 题没做完，另外看答案的题太多了`
  else if (!mustOk) note = `再做 ${needQ} 题就收工`
  else note = '看答案的题太多了，今天不算完成'
  return { timeOk, mustOk, peekOk, done: mustOk && peekOk, needSec, needQ, note }
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

/**
 * 单题耗时（秒），取自近 7 天**实测**：有效时间 ÷ 作答题数。
 * 以前写死 20，结果「按手速倒推题量」成了空话——手快手慢排出来的题量一模一样。
 * 样本不足 10 题就用 20 秒兜底，免得一两道题把计划带跑。
 */
export function perItemSecOf(p: Progress, dayKey: string, days = 7): number {
  const from = bjAddDays(dayKey, -(days - 1))
  let sec = 0, q = 0
  for (const [d, log] of Object.entries(p.dayLog || {})) {
    if (bjDiffDays(d, from) < 0) continue      // 比窗口还早
    if (bjDiffDays(d, dayKey) > 0) continue    // 未来（时钟错乱）
    sec += log.effSec || 0
    q += log.qN || 0
  }
  if (q < 10) return 20
  return Math.min(60, Math.max(6, Math.round(sec / q)))
}

/**
 * 是否已到封顶（该强制收尾了）。
 * 封顶不生效的话，孩子会发现「慢慢做反而不用加」，最优策略就变成磨洋工（方案 11.5）。
 */
export function capHit(plan: DayPlan, effSec: number): boolean {
  return effSec >= plan.maxMin * 60
}
