import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { levelOf, BADGES } from '../lib/gamify'
import { DAILY, UNITS, FINALS, getPlanTrack } from '../lib/data'
import { fetchWordbooks, fetchParentRules } from '../lib/api'
import { dueWrongWords, todayStr } from '../lib/storage'
import type { Track } from '../types'

type Tab = 'daily' | 'unit' | 'final'

export default function Home() {
  const nav = useNavigate()
  const { progress, profiles, profile, switchProfile } = useStore()
  const [tab, setTab] = useState<Tab>('daily')

  const lv = levelOf(progress.points)
  const pct = Math.min(100, Math.round(((progress.points - lv.cur) / Math.max(1, lv.next - lv.cur)) * 100))
  const due = dueWrongWords(progress)

  // 下一个该做的
  const nextTask = useMemo(() => {
    const un = DAILY.find(d => !progress.best[d.id])
    return un || DAILY[0]
  }, [progress.best])

  const todayMin = progress.minutes[todayStr()] || 0
  const doneCount = Object.keys(progress.best).length
  const wrongCount = Object.keys(progress.wrong).length
  const acc = progress.totalAnswers ? Math.round((progress.totalRight / progress.totalAnswers) * 100) : 0

  // 每日计划（家长自定义：每天 N 个新词，总天数自动算）
  const [plan, setPlan] = useState<{ day: number; total: number; bookName: string; count: number } | null>(null)
  useEffect(() => {
    let cancel = false
    // 先刷一次册子配置（激活册子/每日词量，云端为准），再合成今日计划
    fetchWordbooks().catch(() => null).finally(() => {
      void getPlanTrack().then(r => {
        if (!cancel) setPlan({ day: r.day, total: r.total, bookName: r.bookName, count: r.track.wordCount })
      })
    })
    return () => { cancel = true }
  }, [profile.id, progress.planDone])

  const list = tab === 'daily' ? DAILY : tab === 'unit' ? UNITS : FINALS

  // 家长寄语（v2.8）：家长在家长中心写的，云端存储，非空才显示
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
      {/* 身份切换 */}
      <div className="profileBar">
        <div className="pList">
          {profiles.map(p => (
            <button
              key={p.id}
              className={'pChip' + (p.id === profile.id ? ' on' : '')}
              style={p.id === profile.id ? { borderColor: p.color, background: p.color + '14' } : {}}
              onClick={() => switchProfile(p.id)}
            >
              <span className="pe">{p.emoji}</span>
              <span className="pn">{p.name}</span>
            </button>
          ))}
        </div>
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label="设置">⚙️</button>
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

      {/* 等级总览 */}
      <div className="hero">
        <div className="lv">LEVEL {lv.lv}</div>
        <div className="nm">{lv.name}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
        <div className="meta">
          <div><b>{progress.points}</b>积分</div>
          <div><b>{progress.streakDays}</b>连续天数</div>
          <div><b>{todayMin}</b>今日分钟</div>
        </div>
      </div>

      {/* 每日计划：家长定的每天 N 词，做完自动进入下一天 */}
      {plan && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#b2c7f5', background: 'linear-gradient(180deg,#f3f7ff,#fff)' }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div>
              <div className="sub">每日计划 · {plan.bookName}</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                第 {plan.day} / {plan.total} 天
                <span className="sub" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                  每天 {plan.count} 个新词
                </span>
              </div>
            </div>
            <div style={{ fontSize: 30 }}>📅</div>
          </div>
          <button className="btn" style={{ background: 'var(--blue)' }} onClick={() => nav('/d/plan')}>
            ▶ 今日听写
          </button>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Link className="btn ghost sm" to="/print/plan" style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🖨️ 打今日卷
            </Link>
            <Link className="btn ghost sm" to="/translate/plan" style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🔤 翻译巩固
            </Link>
            <Link className="btn ghost sm" to="/spell/plan" style={{ flex: '1 1 40%', textAlign: 'center' }}>
              ✏️ 首字母填空
            </Link>
            <Link className="btn ghost sm" to="/listen/plan" style={{ flex: '1 1 40%', textAlign: 'center' }}>
              📄 纸听一遍
            </Link>
          </div>
        </div>
      )}

      {/* 智能混合卷：只抽学过/错过的词，没学过的绝不出现 */}
      <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>🎲 智能混合卷</div>
            <div className="sub small" style={{ marginTop: 3 }}>
              从学过的词和错词本里随机抽一组混着练，检验记得牢不牢
            </div>
          </div>
          <button className="btn gold sm" onClick={() => nav('/d/mix')}>开始</button>
        </div>
      </div>

      {/* 今日任务：自动推进到第一个没完成的 */}
      {nextTask && (
        <div className="card pad" style={{ marginBottom: 14 }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div>
              <div className="sub">今日任务 · 第 {nextTask.order} / {DAILY.length} 天</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                {nextTask.label || `第 ${nextTask.order} 天`}
                <span className="sub" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                  {nextTask.wordCount} 词
                </span>
              </div>
            </div>
            <div style={{ fontSize: 30 }}>🎧</div>
          </div>
          <button className="btn" onClick={() => nav(`/d/${nextTask.id}`)}>
            ▶ 开始听写
          </button>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {/* 注意：必须用 <Link> 而不是 href="#/..."。
                应用是 BrowserRouter（History 模式），hash 链接不会触发路由导航，
                点击只会往地址栏加个 #，页面纹丝不动（用户报的「点了没反应」就是这个） */}
            <Link className="btn ghost sm" to={`/translate/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🔤 翻译关
            </Link>
            <Link className="btn ghost sm" to={`/spell/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              ✏️ 首字母填空
            </Link>
            <Link className="btn ghost sm" to={`/read/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🎙️ 跟读录音
            </Link>
            <Link className="btn ghost sm" to={`/print/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🖨️ 打纸质卷
            </Link>
            <Link className="btn ghost sm" to={`/paper/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              📷 纸质批改
            </Link>
          </div>
        </div>
      )}

      {/* 快捷入口：训练场 + 游戏中心 + 家长看板 */}
      <div className="quickRow">
        <button className="quick" onClick={() => nav('/train')}>
          <span className="qi">🎯</span>
          <span className="qt">训练场</span>
          <span className="qd">闪卡·限时·拼写</span>
        </button>
        <button className="quick" onClick={() => nav('/games')}>
          <span className="qi">🎮</span>
          <span className="qt">游戏中心</span>
          <span className="qd">连连看·打怪兽</span>
        </button>
        <button className="quick" onClick={() => nav('/parent')}>
          <span className="qi">📊</span>
          <span className="qt">家长中心</span>
          <span className="qd">进度·设置管理</span>
        </button>
      </div>

      {/* 待复习提示 */}
      {due.length > 0 && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
          <div className="between">
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                🔔 今天该复习 {due.length} 个错词
              </div>
              <div className="sub small" style={{ marginTop: 3 }}>
                按遗忘曲线排的，现在复习效果最好
              </div>
            </div>
            <button className="btn gold sm" onClick={() => nav('/review')}>去复习</button>
          </div>
        </div>
      )}

      {/* 统计格 */}
      <div className="stats">
        <div className="stat"><b>{doneCount}</b><span>完成任务</span></div>
        <div className="stat"><b>{acc}%</b><span>总正确率</span></div>
        <div className="stat"><b>{wrongCount}</b><span>待巩固</span></div>
        <div className="stat"><b>{Object.keys(progress.badges).length}</b><span>成就</span></div>
      </div>

      {/* 任务列表 */}
      <div className="tabs">
        {([['daily', '每日课程'], ['unit', '单元测试'], ['final', '期末模考']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      <div className="grid">
        {list.map(t => <Cell key={t.id} t={t} />)}
      </div>

      {/* 成就墙 */}
      <div className="card pad" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>
          🏅 成就墙
          <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>
            {Object.keys(progress.badges).length} / {BADGES.length}
          </span>
        </div>
        <div className="badges">
          {BADGES.map(b => (
            <div key={b.id} className={'bg' + (progress.badges[b.id] ? ' got' : '')} title={b.desc}>
              <div className="i">{b.icon}</div>
              <div className="n">{b.name}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function Cell({ t }: { t: Track }) {
  const nav = useNavigate()
  const { progress } = useStore()
  const best = progress.best[t.id]

  const cls = !best ? '' : best.score >= 90 ? 's100' : best.score >= 60 ? 's60' : 's0'
  const title = t.kind === 'daily' ? `第 ${t.order} 天`
    : t.kind === 'unit' ? `Unit ${String(t.order).padStart(2, '0')}`
      : `期末 ${String(t.order).padStart(2, '0')}`

  // 每日听写 → 逐题反馈模式；单元/期末 → 整卷模考模式
  const go = () => t.kind === 'daily' ? nav(`/d/${t.id}`) : nav(`/exam/${t.id}`)

  return (
    <div className={'cellWrap'}>
      <button className={'cell' + (best ? ' done' : '')} onClick={go}>
        <div className="n">{title}</div>
        <div className="t">{t.wordCount} 词</div>
        {best ? <div className={'s ' + cls}>{best.score}%</div> : <div className="t">未做</div>}
      </button>
      <Link className="cellPrint" to={`/print/${t.id}`} title="打印纸质卷">🖨️</Link>
    </div>
  )
}
