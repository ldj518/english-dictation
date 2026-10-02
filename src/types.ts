/** 核心类型定义 */

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
  }
}
