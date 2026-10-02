import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { DAILY, UNITS, FINALS } from '../lib/data'
import { isFlowTaskId } from '../lib/flow'
import type { Track } from '../types'

/**
 * 考场（v3.5；v3.5.1 自由选关重学）：
 *
 * - 单元测试 / 期末模考：正式检验，格子直达整卷模考，🎯 过关测试 ≥85 亮章
 * - 每日课程：**回头重学任意一天**——点格子从第 1 关（见词听音）走这一天的
 *   完整五关链，可随时跳过直达听写；不占今日闯关进度
 * - 「只看薄弱」筛选：<60 分或没做过的天一键亮出来
 */
type Tab = 'unit' | 'final' | 'daily'

export default function Hall() {
  const nav = useNavigate()
  const { progress } = useStore()
  const [tab, setTab] = useState<Tab>('unit')
  // 薄弱筛选（仅每日课程）：只看 <60 分或没做过的天
  const [weakOnly, setWeakOnly] = useState(false)

  const raw = tab === 'daily' ? DAILY : tab === 'unit' ? UNITS : FINALS
  const list = weakOnly && tab === 'daily'
    ? raw.filter(t => { const b = progress.best[t.id]; return !b || b.score < 60 })
    : raw
  const weakCount = DAILY.filter(t => { const b = progress.best[t.id]; return !b || b.score < 60 }).length

  return (
    <Shell title="🏛️ 考场" back>
      <div className="sub small" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        {tab === 'daily'
          ? '哪天没学好，点那天的格子从第 1 关重新学一遍（学→选→读→拼→听写），随时可跳过直达听写。'
          : '单元过关 ≥85 分亮 🏅；期末卷是整卷模考，考的是综合。日常闯关在首页，这里用来正式检验。'}
      </div>

      <div className="tabs">
        {([
          ['unit', `单元测试`],
          ['final', '期末模考'],
          ['daily', '每日课程'],
        ] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setWeakOnly(false) }}>{t}</button>
        ))}
      </div>

      {/* 薄弱筛选（仅每日课程 tab） */}
      {tab === 'daily' && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={'chip' + (!weakOnly ? ' ok' : '')} onClick={() => setWeakOnly(false)}>全部 {DAILY.length} 天</button>
          <button className={'chip' + (weakOnly ? ' hot' : '')} onClick={() => setWeakOnly(true)}>
            🔻 只看薄弱（{weakCount} 天）
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty"><div className="i">🎉</div><div>没有薄弱的天，全都过关了</div></div>
      ) : (
        <div className="grid">
          {list.map(t => <Cell key={t.id} t={t} />)}
        </div>
      )}

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

  // 每日课程 → 重学链第 1 关（见词听音起步，可跳过直达听写，v3.5.1）；
  // 单元/期末 → 整卷模考模式
  const go = () => isFlowTaskId(t.id) && t.kind === 'daily' ? nav(`/learn/${t.id}`) : nav(`/exam/${t.id}`)

  return (
    <div className={'cellWrap'}>
      <button className={'cell' + (best ? ' done' : '')} onClick={go}>
        <div className="n">{title}{passed ? ' 🏅' : ''}</div>
        <div className="t">{t.wordCount} 词{passed ? ` · 过关 ${passed.score} 分` : ''}</div>
        {best ? <div className={'s ' + cls}>{best.score}%</div> : <div className="t">未做</div>}
      </button>
      {t.kind === 'daily' && (
        <button className="cellPrint cellTest" title="直接听写这天（跳过学习）"
          onClick={() => nav(`/d/${t.id}`)}>🎧</button>
      )}
      {t.kind === 'unit' && (
        <button className="cellPrint cellTest" title="过关测试（20 题，85 分过关）"
          onClick={() => nav(`/test/${t.id}`)}>🎯</button>
      )}
      <button className="cellPrint" title="打印纸质卷" onClick={() => nav(`/print/${t.id}`)}>🖨️</button>
    </div>
  )
}
