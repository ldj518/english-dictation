import { useMemo } from 'react'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { levelOf, BADGES } from '../lib/gamify'
import { todayStr } from '../lib/storage'
import { DAILY, UNITS, FINALS } from '../lib/data'

export default function Stats() {
  const { progress } = useStore()
  const lv = levelOf(progress.points)

  // 最近 14 天分钟数
  const days = useMemo(() => {
    const out: { d: string; min: number; label: string }[] = []
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000)
      const k = todayStr(dt)
      out.push({ d: k, min: progress.minutes[k] || 0, label: k.slice(5) })
    }
    return out
  }, [progress.minutes])
  const maxMin = Math.max(10, ...days.map(d => d.min))

  // 最近成绩曲线
  const recent = useMemo(
    () => progress.history.slice(0, 12).reverse(),
    [progress.history]
  )

  const totalMin = Object.values(progress.minutes).reduce((a, b) => a + b, 0)
  const acc = progress.totalAnswers ? Math.round((progress.totalRight / progress.totalAnswers) * 100) : 0

  const dailyDone = DAILY.filter(d => progress.best[d.id]).length
  const unitDone = UNITS.filter(d => progress.best[d.id]).length
  const finalDone = FINALS.filter(d => progress.best[d.id]).length

  return (
    <Shell title="我的学习">
      {/* 等级 */}
      <div className="hero">
        <div className="lv">LEVEL {lv.lv} · {lv.name}</div>
        <div className="nm">{progress.points} <span style={{ fontSize: 15, fontWeight: 600, opacity: .85 }}>积分</span></div>
        <div className="bar"><i style={{ width: Math.min(100, ((progress.points - lv.cur) / Math.max(1, lv.next - lv.cur)) * 100) + '%' }} /></div>
        <div className="small mt" style={{ opacity: .9 }}>
          距离下一级还差 <b>{Math.max(0, lv.next - progress.points)}</b> 分
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{progress.streakDays}</b><span>连续天数</span></div>
        <div className="stat"><b>{acc}%</b><span>正确率</span></div>
        <div className="stat"><b>{totalMin}</b><span>学习分钟</span></div>
        <div className="stat"><b>{progress.totalAnswers}</b><span>累计答题</span></div>
      </div>

      {/* 学习时长柱状图 */}
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 14 }}>📊 最近 14 天学习时长</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110 }}>
          {days.map(d => (
            <div key={d.d} style={{ flex: 1, textAlign: 'center' }}>
              <div
                title={`${d.d} · ${d.min} 分钟`}
                style={{
                  height: `${Math.max(3, (d.min / maxMin) * 88)}px`,
                  background: d.min > 0 ? 'linear-gradient(180deg,#5b8dfa,#2f5fd0)' : '#e8ecf4',
                  borderRadius: 4,
                  transition: 'height .3s',
                }}
              />
              <div style={{ fontSize: 9, color: 'var(--sub)', marginTop: 4, transform: 'scale(.9)' }}>
                {d.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 成绩曲线 */}
      {recent.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 14 }}>📈 最近 {recent.length} 次成绩</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
            {recent.map((h, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: h.score >= 60 ? 'var(--ok)' : 'var(--bad)' }}>
                  {h.score}
                </div>
                <div style={{
                  height: `${Math.max(4, (h.score / 100) * 70)}px`,
                  background: h.score >= 90 ? 'var(--ok)' : h.score >= 60 ? 'var(--gold)' : 'var(--bad)',
                  borderRadius: 4, marginTop: 3,
                }} />
              </div>
            ))}
          </div>
          <div className="sub small mt center">从左到右是时间顺序</div>
        </div>
      )}

      {/* 完成进度 */}
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 14 }}>🎯 完成进度</div>
        {[
          { k: '每日课程', done: dailyDone, total: DAILY.length, color: 'var(--blue)' },
          { k: '单元测试', done: unitDone, total: UNITS.length, color: 'var(--purple)' },
          { k: '期末模考', done: finalDone, total: FINALS.length, color: 'var(--gold)' },
        ].map(x => (
          <div key={x.k} style={{ marginBottom: 14 }}>
            <div className="between small" style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>{x.k}</span>
              <span className="sub">{x.done} / {x.total}</span>
            </div>
            <div className="progressbar">
              <i style={{ width: `${(x.done / x.total) * 100}%`, background: x.color }} />
            </div>
          </div>
        ))}
      </div>

      {/* 成就 */}
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 12 }}>
          🏅 成就 ({Object.keys(progress.badges).length}/{BADGES.length})
        </div>
        <div className="badges">
          {BADGES.map(b => {
            const got = progress.badges[b.id]
            return (
              <div key={b.id} className={'bg' + (got ? ' got' : '')}>
                <div className="i">{b.icon}</div>
                <div className="n">{b.name}</div>
                <div className="small sub" style={{ fontSize: 9, marginTop: 2 }}>{b.desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 历史记录 */}
      {progress.history.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🕐 练习记录</div>
          {progress.history.slice(0, 20).map((h, i) => (
            <div key={i} className="rv">
              <span className="mk">{h.score >= 90 ? '🏆' : h.score >= 60 ? '👍' : '📖'}</span>
              <span className="w" style={{ fontSize: 14 }}>{h.trackLabel}</span>
              <span className="sub small">{h.right}/{h.total}</span>
              <span className="pill" style={{
                background: h.score >= 60 ? 'var(--ok-soft)' : 'var(--bad-soft)',
                color: h.score >= 60 ? 'var(--ok)' : 'var(--bad)',
              }}>{h.score}%</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
