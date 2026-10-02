/**
 * 五关闯关路径（v3.5）。
 *
 * 每天一条主线：认知难度递进（输入 → 辨认 → 输出）——
 *   1 见词听音（Learn 卡片流）  → /learn/plan
 *   2 听音选义（Translate 6选1）→ /translate/plan
 *   3 开口跟读（Read，可跳过）  → /read/plan
 *   4 首字母拼写（Spell）       → /spell/plan
 *   5 听写大关（Dictation）     → /d/plan
 *
 * 进度存 Progress.flow[yyyy-mm-dd].step（已完成到第几关），只进不退。
 * 全部复用现有 plan 任务页，结算页由 FlowNextBar 串到下一关。
 */
import type { Progress } from '../types'
import { todayStr } from './storage'

export interface FlowStep {
  /** 关号 1-5 */
  step: number
  /** 页面 kind（配 FlowNextBar 按当前页推断来源） */
  kind: 'learn' | 'translate' | 'read' | 'spell' | 'dictation'
  /** 关名 */
  label: string
  /** 该关入口路由（plan 任务） */
  route: string
  /** 一句话说明（给孩子的） */
  desc: string
  /** 图标 */
  icon: string
}

export const FLOW_STEPS: FlowStep[] = [
  { step: 1, kind: 'learn', label: '见词听音', route: '/learn/plan', desc: '看单词、听发音、记意思', icon: '👀' },
  { step: 2, kind: 'translate', label: '听音选义', route: '/translate/plan', desc: '6 选 1，只选不打字', icon: '🎧' },
  { step: 3, kind: 'read', label: '开口跟读', route: '/read/plan', desc: '跟着读，不计分，可跳过', icon: '🗣️' },
  { step: 4, kind: 'spell', label: '首字母拼写', route: '/spell/plan', desc: '中文提示 + 首字母 + 词长', icon: '✏️' },
  { step: 5, kind: 'dictation', label: '听写大关', route: '/d/plan', desc: '整卷 10 词，无提示', icon: '⚔️' },
]

/** 第几关页面对应的 flow step（结算页接线用：页面 kind → step） */
export const KIND_TO_STEP: Record<FlowStep['kind'], number> = {
  learn: 1, translate: 2, read: 3, spell: 4, dictation: 5,
}

/**
 * 今天的下一步关号：1-5 = 还没过到这关；6 = 今日已通关。
 */
export function flowStepOf(progress: Progress, today = todayStr()): number {
  const done = progress.flow?.[today]?.step || 0
  return Math.min(5, done) + 1
}

/** 今日闯关是否已全部完成 */
export function flowAllDone(progress: Progress, today = todayStr()): boolean {
  return (progress.flow?.[today]?.step || 0) >= 5
}

/**
 * 幂等推进（纯函数，store.advanceFlow 调用，logic-test 直测）：
 * step = 刚完成的关号。只有「正在打这一关」（cur+1 === step）才记账，
 * 重放/乱序提交返回 null 不动账；同一天只进不退。
 */
export function flowAdvance(
  flow: NonNullable<Progress['flow']>, step: number, day: string
): NonNullable<Progress['flow']> | null {
  const cur = flow[day]?.step || 0
  if (step !== cur + 1) return null
  return { ...flow, [day]: { step } }
}

/**
 * 可走「五关链」的任务 id（v3.5.1 自由选关重学）：
 * - 'plan' ：今日主线，完成后记账（flowAdvance）
 * - dayXX  ：考场重学某一天，走同一条链但不记账，做完即散
 * - 其他（mix/custom/review/unit/final）：不走五关链，页面只给普通按钮
 */
export function isFlowTaskId(id: string): boolean {
  return id === 'plan' || /^day\d+$/.test(id)
}
