import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import ProfileSwitcher from '../components/ProfileSwitcher'
import { useStore } from '../lib/store'
import { levelOf } from '../lib/gamify'
import { getPlanTrack, DAILY } from '../lib/data'
import { fetchWordbooks, fetchParentRules } from '../lib/api'
import { dueWrongWords, todayStr } from '../lib/storage'
import { dueReviews } from '../lib/reviewQueue'
import { FLOW_STEPS, flowStepOf, FLOW_SCORED } from '../lib/flow'

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

  // ── 计划卡选中天（v3.9 合并卡）：null = 今天；N = 计划第 N 天（卡片原地切换）──
  const [selDay, setSelDay] = useState<number | null>(null)
  /** 今天对应计划第几天：planLog 里反查今天（今天交过卷），否则 = planDone+1（今天在学/没学） */
  const todayNo = useMemo(() => {
    const hit = Object.entries(progress.planLog || {}).find(([, d]) => d === today)
    if (hit) return Number(hit[0])
    return Math.min((progress.planDone || 0) + 1, plan?.total || 9999)
  }, [progress.planLog, progress.planDone, plan?.total, today])
  /** 选中天的展示数据（selDay=null 时取今天） */
  const sel = useMemo(() => {
    if (selDay === null) {
      return {
        isToday: true, no: todayNo, date: progress.planLog?.[todayNo],
        fe: progress.flow?.[today], id: 'day' + String(todayNo).padStart(2, '0'),
        doneCount: flowDoneCount, learned: true,
      }
    }
    const date = progress.planLog?.[selDay]
    const fe = date ? progress.flow?.[date] : undefined
    return {
      isToday: false, no: selDay, date,
      fe, id: 'day' + String(selDay).padStart(2, '0'),
      doneCount: fe?.step || 0, learned: !!date,
    }
  }, [selDay, todayNo, progress.planLog, progress.flow, progress.planDone, flowDoneCount, today])
  /** 选中天每天的词数（末天可能不足 10，按任务实词数算） */
  const selCount = DAILY.find(t => t.id === sel.id)?.wordCount || plan?.count || 0

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

  // ── 每日计划日期条（v3.7）：整个计划期逐天可切，点一天进选关页 ──
  // date→dayNo 反查（planLog: dayNo→date）由 planLog 直接给
  const shortDate = (d: string) => {
    const [, m, dd] = d.split('-').map(Number)
    return `${m}/${dd}`
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

      {/* ── 主区：每日计划合并卡（v3.9）——闯关卡与日期条合一，点哪天卡片原地切换哪天 ── */}
      <div className={'card pad todayCard' + (sel.isToday && serious ? ' serious' : '')}>
        <div className="between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {sel.isToday
                ? (flowDone ? '🎉 今日五关已通关' : `Today · 第 ${flowDoneCount + 1} 关`)
                : `第 ${sel.no} 天 · ${sel.date ? shortDate(sel.date) : '未学'}`}
            </div>
            <div className="sub small" style={{ marginTop: 3 }}>
              {plan
                ? `每日计划 · 已学 ${progress.planDone || 0}/${plan.total} 天 · ${selCount} 个新词`
                : '每日计划 · 词单准备中…'}
            </div>
          </div>
          <div className="tcStep">第 {sel.doneCount}/5 关</div>
        </div>

        {/* 日期条（合并进卡）：点哪天，上面的标题/五关格/按钮就切到哪天 */}
        {plan && (
          <div className="dayStrip" style={{ marginBottom: 12 }}>
            {Array.from({ length: plan.total }, (_, i) => i + 1).map(no => {
              const date = progress.planLog?.[no]
              const fe = date ? progress.flow?.[date] : undefined
              const isTodayCell = no === todayNo
              const isSel = selDay === no || (selDay === null && isTodayCell)
              return (
                <button key={no} className={'dsc' + (isSel ? ' today' : '')}
                  onClick={() => setSelDay(isTodayCell ? null : no)}>
                  <div className="dscNo">{isTodayCell ? '今天' : `第${no}天`}</div>
                  <div className="dscBar">
                    {FLOW_STEPS.map(s => {
                      const r = date ? progress.flow?.[date]?.steps?.[s.step] : undefined
                      const bad = r && FLOW_SCORED[s.step] ? r.t - r.r : 0
                      const passed = !!fe && s.step <= fe.step
                      const color = !passed ? 'var(--line)'
                        : bad > 0 ? (bad * 2 > r!.t ? '#e05a4e' : '#e8a13c')
                        : 'var(--ok)'
                      return <span key={s.step} style={{ background: color }} />
                    })}
                  </div>
                  <div className="dscDate">{date ? shortDate(date) : isTodayCell ? '在学' : '未学'}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* 五关格（v3.7 可点 + v3.9 跟随选中天）：
            今天 = 原规则（已过关重做/当前关继续/未到关确认后可跳，账本幂等兜底）；
            历史天 = 五关全部可单点重做（重学不记今日账，无副作用，无需确认） */}
        <div className="flowGrid">
          {FLOW_STEPS.map(s => {
            const res = sel.fe?.steps?.[s.step]
            const bad = res && FLOW_SCORED[s.step] ? res.t - res.r : 0
            const badHalf = bad > 0 && bad * 2 > (res?.t || 1)
            if (sel.isToday) {
              const done = flowDoneCount >= s.step
              const cur = !done && s.step === step
              const cls = 'fg' + (bad > 0 ? (badHalf ? ' bad' : ' warn') : done ? ' done' : cur ? ' cur' : '')
              const icon = done || bad > 0 ? (badHalf ? '✗' : bad > 0 ? '⚠' : '✓') : s.icon
              const locked = s.step > step
              return (
                <button key={s.step} className={cls}
                  onClick={() => {
                    if (locked && !window.confirm(`「${s.label}」还没轮到（现在该做第 ${step} 关）。可以先做这一关，但不会计入今日闯关进度，确定去吗？`)) return
                    nav(s.route)
                  }}>
                  <div className="fgi">{icon}</div>
                  <div className="fgn">{s.label}</div>
                  {bad > 0 && <div className="fgb">错{bad}</div>}
                </button>
              )
            }
            const done = sel.doneCount >= s.step
            const cls = 'fg' + (bad > 0 ? (badHalf ? ' bad' : ' warn') : done ? ' done' : '')
            const icon = done || bad > 0 ? (badHalf ? '✗' : bad > 0 ? '⚠' : '✓') : s.icon
            return (
              <button key={s.step} className={cls}
                onClick={() => nav(s.route.replace(/\/plan$/, '/' + sel.id))}>
                <div className="fgi">{icon}</div>
                <div className="fgn">{s.label}</div>
                {bad > 0 && <div className="fgb">错{bad}</div>}
              </button>
            )
          })}
        </div>

        {/* 按钮区：今天 = 闯关/复习；历史天 = 重走链 + 打印 + 回今天 */}
        {sel.isToday ? (
          <>
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
          </>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn tcGo" style={{ flex: 1.4 }}
              onClick={() => nav('/learn/' + sel.id)}>
              {sel.learned ? '🔁 重走这天的五关' : '▶ 加练这天的词'}
            </button>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => nav('/print/' + sel.id)}>🖨️ 纸质卷</button>
            <button className="btn ghost" style={{ flex: 0.8 }} onClick={() => setSelDay(null)}>↑ 今天</button>
          </div>
        )}

        {/* 等级/积分压缩行：信息还在，不再各占一张卡 */}
        <div className="tcMeta">
          LV.{lv.lv} {lv.name} · {progress.points} 积分 · 连续 {progress.streakDays} 天 · 今日 {todayMin} 分钟
        </div>
      </div>

      {sel.isToday && plan && (
        <div className="sub small" style={{ marginTop: 8, paddingLeft: 4 }}>
          上面的日期条点任意一天，卡片就切到那天——重做单关或重走整条链都行，成绩记最新一次，不影响今天的计划进度。
        </div>
      )}

      {/* ── 状态行：按需亮灯，没有的项直接消失 ── */}
      <div className="chips">
        <button className={'chip' + (trio.n === 3 ? ' ok' : '')} onClick={goTrio}>
          {trio.n === 3 ? '✓ 三件事齐了 +30' : `✅ 三件事 ${trio.n}/3`}
        </button>
        {due.length > 0 && (
          <button className="chip warn" onClick={() => nav('/review')}>🔔 错词复习 {due.length}</button>
        )}
        {rvDue > 0 && (
          <button className="chip warn" onClick={() => nav('/d/review')}>📖 该复习 {rvDue} 词</button>
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
