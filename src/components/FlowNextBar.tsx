import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { FLOW_STEPS } from '../lib/flow'
import { todayStr } from '../lib/storage'

/**
 * 闯关结算条（v3.5）：放在各关结算页底部。
 *
 * doneStep = 刚完成的关号（1-5）。内部读今天的 flow 账本决定显示什么：
 * - 本关已记账、还有下一关 → 下一关引导卡（关名 + 一句话说明 + 大按钮）
 * - 本关已记账、是第 5 关   → 今日通关卡（回首页看结算）
 * - 本关没记上账（乱序提交）→ null，页面原有的回首页按钮兜底
 *
 * 推进本身由各页结算点调 advanceFlow（幂等），本组件只读不写。
 *
 * active：本次会话是否属于闯关任务（plan）。普通任务（day01 等）做完不显示闯关引导。
 */
export default function FlowNextBar({ doneStep, active }: { doneStep: number; active: boolean }) {
  const { progress } = useStore()
  const nav = useNavigate()
  if (!active) return null
  const done = progress.flow?.[todayStr()]?.step || 0
  if (done < doneStep) return null
  const next = FLOW_STEPS[doneStep]   // 数组 0 起：刚完成第 doneStep 关，下一关正好是这个下标
  if (!next) {
    return (
      <div className="card flowDone">
        <div className="fdTitle">🎉 今日五关全部通关！</div>
        <div className="fdSub">从认词到听写，今天的词已经完完整整过了一轮</div>
        <button className="btn" style={{ background: 'var(--blue)', width: '100%', minHeight: 50 }} onClick={() => nav('/')}>
          回首页看今日结算 →
        </button>
      </div>
    )
  }
  return (
    <div className="card flowNext">
      <div className="fnHead">下一关 · 第 {next.step} / 5 关</div>
      <div className="fnName">{next.icon} {next.label}</div>
      <div className="fnDesc">{next.desc}</div>
      <button className="btn" style={{ background: 'var(--blue)', width: '100%', minHeight: 50 }} onClick={() => nav(next.route)}>
        开始第 {next.step} 关 →
      </button>
    </div>
  )
}
