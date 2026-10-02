import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { DAILY, UNITS, FINALS } from '../lib/data'
import type { Track } from '../types'

/**
 * 考场（v3.5）：把旧首页的「每日课程 / 单元测试 / 期末模考」三块任务墙
 * 和纸质相关入口收进来。首页只留闯关主线，正式考试类内容都在这里。
 */
type Tab = 'unit' | 'final' | 'daily'

export default function Hall() {
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('unit')

  const list = tab === 'daily' ? DAILY : tab === 'unit' ? UNITS : FINALS

  return (
    <Shell title="🏛️ 考场" back>
      <div className="sub small" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        单元过关 ≥85 分亮 🏅；期末卷是整卷模考，考的是综合。日常闯关在首页，这里用来正式检验。
      </div>

      <div className="tabs">
        {([
          ['unit', `单元测试`],
          ['final', '期末模考'],
          ['daily', '每日课程'],
        ] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      <div className="grid">
        {list.map(t => <Cell key={t.id} t={t} />)}
      </div>

      {/* 纸质工具行 */}
      <div className="card pad" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>🖨️ 纸质工具</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/days')}>🗓️ 选日子打印</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/print/plan')}>📄 今日纸质卷</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/listen/plan')}>📄 纸听一遍</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/paper/plan')}>📷 纸质批改</button>
        </div>
        <div className="sub small" style={{ marginTop: 8, lineHeight: 1.6 }}>
          一张卷只印一种信息形态：题目版/答案版分开出，答案版带「批改专用」水印。
        </div>
      </div>
    </Shell>
  )
}

function Cell({ t }: { t: Track }) {
  const nav = useNavigate()
  const { progress } = useStore()
  const best = progress.best[t.id]
  // 单元过关章（v3.4）：≥85 分过关后单元卡常亮
  const passed = t.kind === 'unit' ? progress.passed?.[t.id] : undefined

  const cls = !best ? '' : best.score >= 90 ? 's100' : best.score >= 60 ? 's60' : 's0'
  const title = t.kind === 'daily' ? `第 ${t.order} 天`
    : t.kind === 'unit' ? `Unit ${String(t.order).padStart(2, '0')}`
      : `期末 ${String(t.order).padStart(2, '0')}`

  // 每日听写 → 逐题反馈模式；单元/期末 → 整卷模考模式
  const go = () => t.kind === 'daily' ? nav(`/d/${t.id}`) : nav(`/exam/${t.id}`)

  return (
    <div className={'cellWrap'}>
      <button className={'cell' + (best ? ' done' : '')} onClick={go}>
        <div className="n">{title}{passed ? ' 🏅' : ''}</div>
        <div className="t">{t.wordCount} 词{passed ? ` · 过关 ${passed.score} 分` : ''}</div>
        {best ? <div className={'s ' + cls}>{best.score}%</div> : <div className="t">未做</div>}
      </button>
      {t.kind === 'unit' && (
        <button className="cellPrint cellTest" title="过关测试（20 题，85 分过关）"
          onClick={() => nav(`/test/${t.id}`)}>🎯</button>
      )}
      <button className="cellPrint" title="打印纸质卷" onClick={() => nav(`/print/${t.id}`)}>🖨️</button>
    </div>
  )
}
