import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import ProfileSwitcher from '../components/ProfileSwitcher'
import { useStore } from '../lib/store'
import { levelOf } from '../lib/gamify'
import { getPlanTrack } from '../lib/data'
import { fetchWordbooks, fetchParentRules } from '../lib/api'
import { dueWrongWords, todayStr } from '../lib/storage'
import { dueReviews } from '../lib/reviewQueue'
import { FLOW_STEPS, flowStepOf } from '../lib/flow'

/**
 * 首页（v3.5 三区改版）：
 *
 * ① 主区 TodayCard —— 唯一大按钮：今天只做「闯关」这一件事（五关递进）；
 *    断档警告、等级、积分压缩成一行小字，不再各占一张卡
 * ② 状态行 —— 三件事 / 错词复习 / 到期回炉 / 今日纸质卷 / 考试倒计时，
 *    按需亮灯（没有就消失，不占地方）
 * ③ 四宫格 —— 考场 / 专项 / 游戏 / 家长：与主线无关的 30+ 个旧入口全收进去
 *
 * 删掉的旧卡（功能去向）：
 * - 每日计划卡、今日任务卡（功能重叠的最大来源）→ 合并进 TodayCard
 * - 三件事大卡 → 状态行一个 chip
 * - 智能混合卷、短语专项 → /extra 专项页
 * - tabs + 57 格任务墙 → /hall 考场页
 * - 成就墙、统计格 → /stats 统计页
 * - 考前冲刺卡 → 状态行倒计时 chip（逻辑原样保留）
 */
export default function Home() {
  const nav = useNavigate()
  const { progress, profile } = useStore()

  const lv = levelOf(progress.points)
  const today = todayStr()
  const todayMin = progress.minutes[today] || 0
  const due = dueWrongWords(progress)
  const rvDue = dueReviews(progress).length

  // ── 闯关主线（v3.5）：今天走到第几关 ──
  const step = flowStepOf(progress)            // 1-5 = 下一步该做的关；6 = 已通关
  const flowDone = step >= 6
  const curStep = FLOW_STEPS[Math.min(5, step) - 1]
  const flowDoneCount = Math.min(5, (progress.flow?.[today]?.step || 0))

  // ── 每日计划（家长自定义每天 N 词，总天数自动算）──
  const [plan, setPlan] = useState<{ day: number; total: number; bookName: string; count: number } | null>(null)
  useEffect(() => {
    let cancel = false
    // 先刷册子配置（激活册子/每日词量，云端为准），再合成今日计划
    fetchWordbooks().catch(() => null).finally(() => {
      void getPlanTrack().then(r => {
        if (!cancel) setPlan({ day: r.day, total: r.total, bookName: r.bookName, count: r.track.wordCount })
      })
    })
    return () => { cancel = true }
  }, [profile.id, progress.planDone])

  // 断档（v3.3 语义保留）：断 2 天+ 红色警告，1 天橙提示
  const gapDays = useMemo(() => {
    if (!progress.lastDay) return 0
    const [y1, m1, d1] = progress.lastDay.split('-').map(Number)
    const [y2, m2, d2] = today.split('-').map(Number)
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
  }, [progress.lastDay])
  const miss = gapDays - 1
  const serious = miss >= 2 && !!progress.lastDay

  // ── 今日三件事（v3.3）：从记录现算 ──
  const trio = useMemo(() => {
    const th = progress.history.filter(h => todayStr(new Date(h.at)) === today)
    const didDict = th.some(h => !h.trackId.endsWith('-t'))
    const didTrans = th.some(h => h.trackId.endsWith('-t'))
    const reviewClear = dueReviews(progress).length === 0
    return { didDict, reviewClear, didTrans, n: [didDict, reviewClear, didTrans].filter(Boolean).length }
  }, [progress])
  const goTrio = () => {
    if (!trio.didDict) nav('/d/plan')
    else if (!trio.reviewClear) nav('/d/review')
    else if (!trio.didTrans) nav('/translate/plan')
    else nav('/hall')
  }

  // ── 考试倒计时（v3.4 逻辑原样保留，压成状态行 chip）──
  const examDays = useMemo(() => {
    const examDate = progress.settings.examDate
    if (!examDate) return null
    const exam = new Date(examDate + 'T00:00:00').getTime()
    const today0 = new Date(today + 'T00:00:00').getTime()
    const daysLeft = Math.round((exam - today0) / 86400000)
    if (daysLeft < 0 || daysLeft > 14) return null // 考完/冲刺期外不打扰
    return daysLeft
  }, [progress.settings.examDate])
  const goSprint = () => {
    // 冲刺卷：近 14 天碰过的错词优先，按累计错误次数排
    const since = Date.now() - 14 * 86400000
    const pool = Object.values(progress.wrong).filter(w => w.lastAt >= since)
    const list = (pool.length ? pool : Object.values(progress.wrong))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map(w => ({ word: w.word, cn: w.cn }))
    if (!list.length) { alert('错词本是空的，直接做今天的每日计划卷就行'); return }
    sessionStorage.setItem('custom-words', JSON.stringify(list))
    sessionStorage.setItem('custom-label', '考前冲刺卷')
    nav('/d/custom')
  }

  // 家长寄语（家长中心设置，云端同步）
  const [pmsg, setPmsg] = useState('')
  useEffect(() => {
    let cancel = false
    fetchParentRules().then(r => { if (!cancel) setPmsg((r.parentMessage || '').trim()) }).catch(() => { /* 静默 */ })
    return () => { cancel = true }
  }, [])

  return (
    <Shell title="英语听写" right={
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="设置">⚙️</button>
    }>
      {/* 身份：只显示当前孩子；切人走弹层（有意操作，防误触记错人） */}
      <div className="profileBar">
        <ProfileSwitcher />
      </div>

      {/* 家长寄语（家长中心设置，云端同步） */}
      {pmsg && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>💌</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>{pmsg}</div>
              <div className="sub small" style={{ marginTop: 2 }}>—— 家长的话</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 主区：今日闯关卡（v3.5）── */}
      <div className={'card pad todayCard' + (serious ? ' serious' : '')}>
        <div className="between" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {flowDone ? '🎉 今日五关已通关' : `Today · 第 ${flowDoneCount + 1} 关`}
            </div>
            <div className="sub small" style={{ marginTop: 3 }}>
              {plan
                ? `每日计划 · 第 ${plan.day}/${plan.total} 天 · ${plan.count} 个新词`
                : '每日计划 · 词单准备中…'}
            </div>
          </div>
          <div className="tcStep">第 {flowDoneCount}/5 关</div>
        </div>

        {/* 五关进度条：✓ 绿 = 已过 · 蓝 = 当前 · 灰 = 未到 */}
        <div className="flowGrid">
          {FLOW_STEPS.map(s => {
            const done = flowDoneCount >= s.step
            const cur = !done && s.step === step
            return (
              <div key={s.step} className={'fg' + (done ? ' done' : cur ? ' cur' : '')}>
                <div className="fgi">{done ? '✓' : s.icon}</div>
                <div className="fgn">{s.label}</div>
              </div>
            )
          })}
        </div>

        {serious && (
          <div className="gapWarn">
            📢 停了 {miss} 天，词汇在往回漏。漏掉的词复习队列会自动安排回炉，今天从第 {plan?.day ?? '—'} 天接着走就行。
          </div>
        )}

        {flowDone ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => nav('/d/review')}>📋 去复习巩固</button>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => nav('/hall')}>🏛️ 去考场加练</button>
          </div>
        ) : (
          <button className="btn tcGo" onClick={() => nav(curStep.route)}>
            {step === 1 ? '▶ 开始今天的闯关 · ' : serious ? '⚡ 补上 · ' : '▶ 继续第 ' + step + ' 关 · '}{curStep.icon} {curStep.label}
          </button>
        )}

        {/* 等级/积分压缩行：信息还在，不再各占一张卡 */}
        <div className="tcMeta">
          LV.{lv.lv} {lv.name} · {progress.points} 积分 · 连续 {progress.streakDays} 天 · 今日 {todayMin} 分钟
        </div>
      </div>

      {/* ── 状态行：按需亮灯，没有的项直接消失 ── */}
      <div className="chips">
        <button className={'chip' + (trio.n === 3 ? ' ok' : '')} onClick={goTrio}>
          {trio.n === 3 ? '✓ 三件事齐了 +30' : `✅ 三件事 ${trio.n}/3`}
        </button>
        {due.length > 0 && (
          <button className="chip warn" onClick={() => nav('/review')}>🔔 错词复习 {due.length}</button>
        )}
        {rvDue > 0 && (
          <button className="chip" onClick={() => nav('/d/review')}>📋 到期回炉 {rvDue}</button>
        )}
        <button className="chip" onClick={() => nav('/print/plan')}>🖨️ 今日纸质卷</button>
        {examDays !== null && (
          <button className="chip hot" onClick={goSprint}>
            🎯 考前 {examDays === 0 ? '不到 1' : examDays} 天 · 一键冲刺卷
          </button>
        )}
      </div>

      {/* ── 四宫格：主线之外的一切入口 ── */}
      <div className="quickRow">
        <button className="quick" onClick={() => nav('/hall')}>
          <span className="qi">🏛️</span>
          <span className="qt">考场</span>
          <span className="qd">单元·期末·纸批</span>
        </button>
        <button className="quick" onClick={() => nav('/extra')}>
          <span className="qi">🧰</span>
          <span className="qt">专项</span>
          <span className="qd">短语·混合·词形</span>
        </button>
        <button className="quick" onClick={() => nav('/games')}>
          <span className="qi">🎮</span>
          <span className="qt">游戏</span>
          <span className="qd">连连看·打怪兽</span>
        </button>
        <button className="quick" onClick={() => nav('/parent')}>
          <span className="qi">📊</span>
          <span className="qt">家长</span>
          <span className="qd">看板·周报·设置</span>
        </button>
      </div>
    </Shell>
  )
}
