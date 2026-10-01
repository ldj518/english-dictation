import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { fetchStats, checkBackend, type StatsResp } from '../lib/api'
import { sharePoster } from '../lib/poster'

type Range = 'day' | 'week' | 'month'

/**
 * 家长看板：按 日 / 周 / 月 查看学习进度。
 * 数据来自 Cloudflare D1（后端），跨设备可见。
 * 后端不通时降级为本地数据 + 明确提示。
 */
export default function Parent() {
  const nav = useNavigate()
  const { profiles, profile, progress, switchProfile } = useStore()
  const [range, setRange] = useState<Range>('week')
  const [stats, setStats] = useState<StatsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    checkBackend().then(alive => {
      if (cancel) return
      setOnline(alive)
      if (!alive) { setLoading(false); return }
      fetchStats(profile.id, range, 30).then(s => {
        if (cancel) return
        setStats(s)
        setLoading(false)
      })
    })
    return () => { cancel = true }
  }, [profile.id, range])

  const s = stats?.summary

  // 本地兜底数据
  const local = useMemo(() => {
    const hist = progress.history || []
    const total = hist.reduce((a, h) => a + h.total, 0)
    const right = hist.reduce((a, h) => a + h.right, 0)
    return {
      sessions: hist.length,
      total,
      right,
      acc: total ? Math.round((right / total) * 100) : 0,
      totalDays: Object.keys(progress.minutes || {}).length,
      streak: progress.streakDays,
    }
  }, [progress])

  const useLocal = online === false
  const S = useLocal ? local : {
    sessions: s?.sessions || 0,
    total: s?.total || 0,
    right: s?.right || 0,
    acc: s?.acc || 0,
    totalDays: s?.totalDays || 0,
    streak: s?.streak || 0,
  }

  const rangeLabel: Record<Range, string> = { day: '今天', week: '本周', month: '本月' }

  return (
    <Shell title="家长看板" back sub={useLocal ? '本地数据' : '云端同步'}>
      {/* 后端状态提示 */}
      {useLocal && (
        <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: '#f0d69a' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>⚠️ 云端未连接，当前显示本机数据</div>
          <div className="sub small" style={{ marginTop: 4, lineHeight: 1.7 }}>
            本机数据只包含这台设备做过的练习。连上云端后，孩子在任意设备上的练习都会汇总到这里。
          </div>
        </div>
      )}

      {/* 周期切换 */}
      <div className="seg" style={{ marginBottom: 14, width: '100%' }}>
        {(['day', 'week', 'month'] as Range[]).map(r => (
          <button key={r} className={range === r ? 'on' : ''} style={{ flex: 1 }}
            onClick={() => setRange(r)}>
            {rangeLabel[r]}
          </button>
        ))}
      </div>

      {/* 周期总览 */}
      <div className="hero">
        <div className="lv">{profile.emoji} {profile.name} · {rangeLabel[range]}</div>
        <div className="nm">{S.acc}% 正确率</div>
        <div className="meta" style={{ marginTop: 10 }}>
          <div><b>{S.sessions}</b>次听写</div>
          <div><b>{S.total}</b>道题</div>
          <div><b>{S.totalDays}</b>总天数</div>
          <div><b>{S.streak}</b>连续</div>
        </div>
      </div>

      {/* 切换孩子 */}
      {profiles.length > 1 && (
        <div className="profileBar">
          <div className="pList">
            {profiles.map(p => (
              <button key={p.id}
                className={'pChip' + (p.id === profile.id ? ' on' : '')}
                style={p.id === profile.id ? { borderColor: p.color, background: p.color + '14' } : {}}
                onClick={() => switchProfile(p.id)}>
                <span className="pe">{p.emoji}</span>
                <span className="pn">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="card pad center sub">加载中…</div>}

      {/* 趋势图 */}
      {!loading && !useLocal && stats && stats.trend.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 12 }}>📈 正确率趋势（近 {stats.trend.length} 天）</div>
          <TrendChart data={stats.trend} />
        </div>
      )}

      {/* 错词 TOP */}
      {!loading && !useLocal && stats && stats.topWrong.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            🎯 高频错词 TOP {stats.topWrong.length}
            <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>近 60 天</span>
          </div>
          <div className="reviewlist" style={{ marginTop: 8 }}>
            {stats.topWrong.map((w, i) => (
              <div key={w.word} className="rv">
                <span className="mk" style={{ color: 'var(--bad)' }}>{i + 1}</span>
                <span className="w">{w.word}</span>
                <span className="sub small">{w.cn}</span>
                <span className="pill p-bad" style={{ marginLeft: 'auto' }}>错 {w.times} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近记录 */}
      {!loading && !useLocal && stats && stats.recent.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🕐 最近练习</div>
          <div className="reviewlist">
            {stats.recent.slice(0, 12).map(r => (
              <div key={r.id} className="rv">
                <span className="mk" style={{
                  color: r.score >= 90 ? 'var(--ok)' : r.score >= 60 ? 'var(--blue)' : 'var(--bad)',
                }}>{r.score}%</span>
                <span className="w" style={{ fontSize: 13 }}>{r.track_label}</span>
                <span className="sub small">
                  {r.right_count}/{r.total}
                  {r.mode === 'paper' && ' · 纸质'}
                  {r.mode === 'exam' && ' · 模考'}
                </span>
                <span className="sub small" style={{ marginLeft: 'auto' }}>{r.day_key.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !useLocal && stats && stats.summary.total === 0 && (
        <div className="card pad center">
          <div style={{ fontSize: 34 }}>📊</div>
          <div style={{ fontWeight: 700, marginTop: 6 }}>这个周期还没有记录</div>
          <div className="sub small" style={{ marginTop: 4 }}>让孩子做一次听写，这里就有数据了</div>
        </div>
      )}

      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost" onClick={() => location.reload()}>🔄 刷新数据</button>
        <button className="btn" style={{ background: '#07c160' }} onClick={() => {
          const acc = S.acc
          sharePoster({
            profile,
            trackLabel: `家长看板 · ${rangeLabel[range]}`,
            date: new Date().toISOString().slice(0, 10),
            score: acc, right: S.right, total: S.total, seconds: 0,
            answers: (stats?.topWrong || []).slice(0, 10).map(w => ({
              word: w.word, cn: w.cn, correct: false, input: '',
            })),
          })
        }}>
          📤 生成周报图（发微信）
        </button>
      </div>

      <div className="center mt" style={{ paddingBottom: 40 }}>
        <button className="btn ghost sm" onClick={() => nav('/stats')}>看我的详细统计 →</button>
      </div>
    </Shell>
  )
}

/** 简易折线图（纯 SVG，无依赖） */
function TrendChart({ data }: { data: { day: string; acc: number; total: number }[] }) {
  const W = 620, H = 160, P = 28
  if (!data.length) return null
  const maxAcc = 100
  const stepX = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0
  const y = (v: number) => H - P - (v / maxAcc) * (H - P * 2)

  const pts = data.map((d, i) => [P + i * stepX, y(d.acc)] as const)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${P},${H - P} Z`

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 400, height: 160 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f5fd0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2f5fd0" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={P} y1={y(v)} x2={W - P} y2={y(v)} stroke="#e4e8f0" strokeWidth="1" />
            <text x={4} y={y(v) + 4} fontSize="10" fill="#8b93a3">{v}</text>
          </g>
        ))}
        <path d={area} fill="url(#g1)" />
        <path d={line} fill="none" stroke="#2f5fd0" strokeWidth="2.2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke="#2f5fd0" strokeWidth="1.8" />
        ))}
        {data.length <= 10 && data.map((d, i) => (
          <text key={d.day} x={P + i * stepX} y={H - 8} fontSize="9" fill="#8b93a3" textAnchor="middle">
            {d.day.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  )
}
