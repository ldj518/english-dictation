/** 核心类型定义 */

// 纯类型 import（编译后擦除，不产生运行时循环依赖）
import type { WordState } from './lib/memory'
import type { StudyConfig } from './lib/plan'

/**
 * 单日会话账本（v4）。
 * 战报、家长后台「今天为什么只有 4 段」、跨天对比，全部读这一个结构。
 */
export interface DayLog {
  dayKey: string
  /** 档位：normal / settle / recover / restart / sat / sun */
  tier: string
  /** 有效学习秒数（相邻操作间隔 ≤60 秒才算） */
  effSec: number
  /** 空闲秒数（挂机） */
  idleSec: number
  /** 必做题完成数 / 总数 */
  mustDone: number
  mustTotal: number
  /** 作答题数 / 首答正确数 / 看答案题数 */
  qN: number
  rightN: number
  peekN: number
  /** 双闸门是否都过（时间 ≥ 下限 且 必做清空） */
  done: boolean
  /** 分段流水账（战报按它画时间条） */
  segs: { k: string; label: string; min: number; q: number; right: number }[]
  /** 已完成的段下标 */
  segDone: number[]
  /** 最后更新时间戳 */
  at: number
}

/** 未结算的进行中会话（退出后回来接着做，只在 WARM/教学段恢复） */
export interface LiveSession {
  dayKey: string
  /** 题目游标 */
  qi: number
  /** 已完成段下标 */
  segDone: number[]
  /** 累计有效/空闲秒 */
  effSec: number
  idleSec: number
  /** 逐题结果（word -> 首答对不对） */
  results: { word: string; kind: string; correct: boolean; peek?: boolean; fast?: boolean; hinted?: boolean }[]
  at: number
}

/** 音频清单里的一条词（运行时形态） */
export interface AudioItem {
  no: number
  word: string
  cn: string
  file: string | null
}

/** tasks.json 里的一条词：元组 [题号, 单词, 中文, 起始秒, 结束秒] */
export type ItemTuple = [number, string, string, number, number]

/** 一个听写任务（一天 / 一个单元 / 一次期末） */
export interface Track {
  id: string
  kind: 'daily' | 'unit' | 'final'
  group: 'daily' | 'unit' | 'final'
  order: number
  label: string
  file: string
  seconds: number
  wordCount: number
  sections: { label: string; start: number; end: number }[]
  /** 元组数组：[题号, 单词, 中文释义, 起始秒, 结束秒] */
  items: ItemTuple[]
}

/** 把任务里的元组转成前端友好的对象数组（在页面层调用一次） */
export function toAudioItems(t: Track): AudioItem[] {
  return t.items.map(([no, word, cn]) => ({ no, word, cn, file: null }))
}

/** 词条 */
export interface Word {
  word: string
  pos: string
  cn: string
  cnFull: string
  firstTask: string
  dayNo: number
  unit: string
}

/** 一次答题记录 */
export interface AnswerRecord {
  no: number
  word: string
  cn: string
  input: string
  correct: boolean
}

/** 一次听写会话结果 */
export interface SessionResult {
  trackId: string
  trackLabel: string
  total: number
  right: number
  score: number
  at: number
  records: AnswerRecord[]
}

/** 错词本条目 */
export interface WrongWord {
  word: string
  cn: string
  count: number          // 累计错误次数
  streak: number         // 连续答对次数（用于复习模式）
  addedAt: number
  lastAt: number
  /** 遗忘曲线：下次复习时间戳 */
  dueAt: number
  /** 复习阶段 0-4，对应 1/2/4/7/15 天 */
  stage: number
  /** 累计答对次数（v3.6）：重听写对/复习答对都 +1，错词重听列表与历史共用 */
  okCount?: number
}

/** 错词总历史条目（v3.6）：只增不删。词从错词本毕业后历史仍保留，随时可重听 */
export interface WrongLogEntry {
  word: string
  cn: string
  /** 累计答错次数 */
  bad: number
  /** 累计答对次数 */
  ok: number
  addedAt: number
  lastAt: number
  /** 最近一次结果 */
  lastOk: 'ok' | 'bad'
  /** 从错词本毕业（满级）的时间；毕业后再答错会重新进错词本 */
  gradAt?: number
}

/** 成就徽章 */
export interface Badge {
  id: string
  name: string
  desc: string
  icon: string
  gotAt?: number
}

/** 一个孩子的身份档案 */
export interface Profile {
  id: string
  name: string
  emoji: string
  color: string
}

/** 用户整体进度 */
export interface Progress {
  /** trackId -> 最好成绩 */
  best: Record<string, { score: number; at: number; right: number; total: number }>
  /** trackId -> 练习次数 */
  attempts: Record<string, number>
  /** 错词本 */
  wrong: Record<string, WrongWord>
  /** 错词总历史（v3.6）：word -> 全生命周期战绩，永不删除。清空错词本也不动它 */
  wrongLog?: Record<string, WrongLogEntry>
  /** 总积分 */
  points: number
  /** 连续打卡天数 */
  streakDays: number
  /** 最近打卡日期 yyyy-mm-dd */
  lastDay: string
  /** 已解锁徽章 */
  badges: Record<string, number>
  /** 累计作答数 / 正确数 */
  totalAnswers: number
  totalRight: number
  /** 历史会话 */
  history: SessionResult[]
  /** 每日学习分钟数 yyyy-mm-dd -> 分钟 */
  minutes: Record<string, number>
  /** 每日计划已完成到第几天（动态任务 /d/plan 用） */
  planDone: number
  /** 学习环节记账（v2.7）：trackId -> 最近一次学习时间/次数/奖励日 */
  learned: Record<string, { at: number; count: number; bonusDay?: string }>
  /** 全词复习队列（v3.1 艾宾浩斯）：word -> 复习档位与下次到期时间 */
  review: Record<string, { stage: number; dueAt: number; addedAt: number }>
  /** 已毕业词（v3.2）：word -> 毕业时间。防止毕业词在日常听写答对后被重新入队，队列永不收敛 */
  reviewDone?: Record<string, number>
  /** 每日计划账本（v3.3）：dayNo -> 首次完成日期。算断档/引导态用 */
  planLog?: Record<number, string>
  /** 完美一天奖励（v3.3）：日期 -> 已发放。听写+复习清零+翻译关全齐 +30 分，每天一次 */
  trioDone?: Record<string, boolean>
  /** 单元过关记录（v3.4）：unitId -> 首次过关分数与日期。≥85% 过关，Home 单元卡亮章 */
  passed?: Record<string, { at: number; score: number }>
  /** 单关成绩（v3.7）：计分关（2/4/5）存对错；1/3 关不计分只记完成。at 用于跨设备合并取最新 */
  steps?: Record<number, { t: number; r: number; at: number }>
  /** 闯关进度（v3.5）：日期 yyyy-mm-dd -> { step: 已完成到第几关 }。只进不退，同日取 step 大者 */
  flow?: Record<string, { step: number; steps?: Record<number, { t: number; r: number; at: number }> }>

  /* ═══════ v4 新增：词级记忆调度 ═══════ */

  /** 词级记忆强度：word -> 状态。取代 review 固定档位，日队列的唯一来源 */
  wordState?: Record<string, WordState>
  /** 每日会话账本：yyyy-mm-dd -> 当日进度与成绩（战报、家长后台、续做都读它） */
  dayLog?: Record<string, DayLog>
  /** 学习配置（家长后台可改，与 parent_rules 分开存，避免整体替换抹字段） */
  studyCfg?: Partial<StudyConfig>
  /** v4 迁移标记：=1 表示已从 review/wrong 反推过 wordState，不再重复迁移 */
  migratedV4?: number
  /** 未结算的当日会话（退出后回来接着做） */
  liveSession?: LiveSession | null

  /** 设置 */
  settings: {
    rate: number
    repeat: number
    gap: number
    voiceMode: 'normal' | 'slow'
    /** 出题是否随机打乱（防规律） */
    shuffle: boolean
    /** 打乱周期：每天（默认，日期即盐）/ 每周（周一换）/ 手动（家长点重排才换） */
    shuffleMode?: 'daily' | 'weekly' | 'manual'
    /** 内置 26 键字母键盘（杜绝输入法联想作弊）；false 时用系统键盘 */
    kbBuiltIn: boolean
    /** 纸质伴写（v2.7）：听写时屏幕显示「第 N 题·写在听写本第 N 行」 */
    syncPaper: boolean
    /** 预习环节档位（v2.8 家长管控）：recommended 可跳过 / force 强制先学 / off 关闭 */
    prepMode?: 'recommended' | 'force' | 'off'
    /** 考试日期（v3.4 冲刺包，家长管控）：yyyy-mm-dd，空串/缺省 = 未设置 */
    examDate?: string
  }
}
