import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { FLOW_STEPS } from '../lib/flow'
import { todayStr } from '../lib/storage'

/**
 * 闯关结算条（v3.5；v3.5.1 支持自由选关重学）。放在各关结算页底部。
 *
 * doneStep = 刚完成的关号（1-5）。taskId 决定行为：
 * - 'plan'  ：今日闯关主线。查今天的 flow 账本，本关已记账才显示；
 *             第 5 关 = 今日通关卡（回首页看结算）
 * - 'dayXX' ：重学某一天（考场每日格进来）。不查账本直接串下一关，
 *             不占今日闯关进度；第 5 关 = 重学完成卡（回考场）
 * - 缺省    ：null（普通任务做完不显示闯关引导，页面原有按钮兜底）
 *
 * 推进记账只发生在 plan（各页 advanceFlow），本组件只读不写。
 */
export default function FlowNextBar({ doneStep, taskId }: { doneStep: number; taskId?: string }) {
  const { progress } = useStore()
  const nav = useNavigate()
  if (!taskId) return null
  const isPlan = taskId === 'plan'
  if (isPlan) {
    const done = progress.flow?.[todayStr()]?.step || 0
    if (done < doneStep) return null   // 本关没记上账（乱序），页面原有按钮兜底
  }
  const next = FLOW_STEPS[doneStep]   // 数组 0 起：刚完成第 doneStep 关，下一关正好是这个下标
  if (!next) {
    return isPlan ? (
      <div className="card flowDone">
        <div className="fdTitle">🎉 今日五关全部通关！</div>
        <div className="fdSub">从认词到听写，今天的词已经完完整整过了一轮</div>
        <button className="btn" style={{ background: 'var(--blue)', width: '100%', minHeight: 50 }} onClick={() => nav('/')}>
          回首页看今日结算 →
        </button>
      </div>
    ) : (
      <div className="card flowDone">
        <div className="fdTitle">✓ 这一天重学完成！</div>
        <div className="fdSub">五关都过了一遍，错的词已进错词本，复习队列会安排回炉</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" style={{ flex: 1, background: 'var(--blue)' }} onClick={() => nav('/hall')}>回考场再选一天</button>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => nav('/')}>回首页</button>
        </div>
      </div>
    )
  }
  // plan 走固定路线；dayXX 把任务 id 换进同一条链（/learn/plan → /learn/day05）
  const target = isPlan ? next.route : next.route.replace(/\/plan$/, '/' + taskId)
  return (
    <div className="card flowNext">
      <div className="fnHead">{isPlan ? `下一关 · 第 ${next.step} / 5 关` : `重学 · 第 ${next.step} / 5 关`}</div>
      <div className="fnName">{next.icon} {next.label}</div>
      <div className="fnDesc">{next.desc}</div>
      <button className="btn" style={{ background: 'var(--blue)', width: '100%', minHeight: 50 }} onClick={() => nav(target)}>
        开始第 {next.step} 关 →
      </button>
    </div>
  )
}
