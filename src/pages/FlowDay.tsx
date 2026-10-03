import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { FLOW_STEPS, FLOW_SCORED } from '../lib/flow'
import { getTrack } from '../lib/data'

/**
 * 选关页（v3.7）：/flow/dayXX —— 某一天的五关总览，每关可单独重做。
 *
 * 从首页「每日计划 · 按天学」日期条点进来。显示那天五关各自的完成情况
 * 与最新成绩（绿✓ 全对 / 橙⚠ 错一半内 / 红✗ 错一半以上），每关一个
 * 「重做」按钮；重做成绩覆盖记回那天的格子（最新一次口径）。
 * 提前学没有副作用：只有今天的主线听写会推进计划天，这里随便练。
 */
export default function FlowDay() {
  const { no } = useParams()
  const nav = useNavigate()
  const { progress } = useStore()
  const n = Number(no?.replace(/^day/, ''))
  const valid = Number.isFinite(n) && n >= 1
  const nn = String(n).padStart(2, '0')
  const taskId = `day${nn}`

  const date = valid ? progress.planLog?.[n] : undefined
  const fe = date ? progress.flow?.[date] : undefined
  const wc = useMemo(() => {
    if (!valid) return 0
    return getTrack(taskId)?.wordCount || 0
  }, [valid, taskId])

  if (!valid) {
    return (
      <Shell title="选关" back>
        <div className="empty">
          <div className="i">🤔</div>
          <div>没有这一天</div>
        </div>
      </Shell>
    )
  }

  const doneCount = fe ? fe.step : 0

  return (
    <Shell title={`第 ${n} 天`} back>
      <div className="card pad" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          📅 第 {n} 天 · {date ? date.slice(5).replace('-', '/') : '还没学到'}
        </div>
        <div className="sub small" style={{ marginTop: 3 }}>
          {wc ? `${wc} 个词 · ` : ''}{doneCount >= 5 ? '五关已通关' : doneCount > 0 ? `完成了 ${doneCount}/5 关` : '还没做过'}
          {date ? ' · 成绩显示最新一次' : ' · 提前学不影响计划节奏'}
        </div>
      </div>

      {/* 五关列表：每关状态 + 成绩 + 单独重做 */}
      <div className="card pad" style={{ marginBottom: 12 }}>
        {FLOW_STEPS.map(s => {
          const r = date ? progress.flow?.[date]?.steps?.[s.step] : undefined
          const bad = r && FLOW_SCORED[s.step] ? r.t - r.r : 0
          const badHalf = bad > 0 && bad * 2 > (r?.t || 1)
          const passed = !!fe && s.step <= fe.step
          const state = !passed ? '没做'
            : bad > 0 ? (badHalf ? `错一半以上（错${bad}题）` : `有错（错${bad}题）`)
            : FLOW_SCORED[s.step] ? '全对' : '已完成'
          const color = !passed ? 'var(--sub)'
            : bad > 0 ? (badHalf ? '#c23a2f' : '#b57708')
            : '#2f7d1e'
          return (
            <div key={s.step} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0', borderTop: s.step > 1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{s.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{s.step}. {s.label}</div>
                <div style={{ fontSize: 12, color, fontWeight: 700, marginTop: 2 }}>{state}</div>
              </div>
              <button className="btn ghost sm" style={{ flexShrink: 0 }}
                onClick={() => nav(s.route.replace(/\/plan$/, '/' + taskId))}>
                {passed ? '重做这关' : '去做'} ›
              </button>
            </div>
          )
        })}
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <button className="btn" style={{ flex: 1, background: 'var(--blue)' }}
          onClick={() => nav(`/learn/${taskId}`)}>
          🔁 从第 1 关走整条链
        </button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => nav(`/print/${taskId}`)}>
          🖨️ 打印这天的纸质卷
        </button>
      </div>
      <button className="btn ghost" style={{ width: '100%' }} onClick={() => nav('/')}>
        ↑ 回到今天（首页闯关卡）
      </button>

      <div className="sub small" style={{ marginTop: 10, lineHeight: 1.7 }}>
        重做成绩会覆盖这天的旧成绩（记最新一次）；答错的词照常进错词本。
      </div>
    </Shell>
  )
}
