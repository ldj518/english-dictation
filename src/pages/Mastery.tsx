import { useMemo } from 'react'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { UNIT_WORDS, WORDS, WORD_MAP, getTrack, playWordText } from '../lib/data'

/** 词的掌握状态（v3.1 掌握度地图） */
type St = 'new' | 'learned' | 'testing' | 'master' | 'bad'

const ST_META: Record<St, { label: string; bg: string; fg: string }> = {
  new:     { label: '还没测',   bg: '#ecebe4', fg: '#6b6a64' },
  learned: { label: '学过没测', bg: '#b5d4f4', fg: '#0c447c' },
  testing: { label: '巩固中',   bg: '#fac775', fg: '#633806' },
  master:  { label: '已掌握',   bg: '#c0dd97', fg: '#27500a' },
  bad:     { label: '要攻错',   bg: '#f09595', fg: '#791f1f' },
}

const ORDER: St[] = ['bad', 'testing', 'master', 'learned', 'new']

/**
 * 词级状态聚合：从历史会话（最近 200 次内）按时间正序回放每词对错，
 * 错词本里的词优先标红（无论近期对错，进了错词本就是要攻的）。
 */
function useMastery() {
  const { progress } = useStore()

  return useMemo(() => {
    const recent = new Map<string, { streak: number; n: number }>()
    const hist = [...(progress.history || [])].sort((a, b) => a.at - b.at)
    for (const s of hist) {
      for (const r of s.records) {
        const e = recent.get(r.word) || { streak: 0, n: 0 }
        e.streak = r.correct ? e.streak + 1 : 0
        e.n += 1
        recent.set(r.word, e)
      }
    }

    // 学过没测：学习环节碰过（learned 按 trackId 记账），但没在听写里出现过
    const learnedSet = new Set<string>()
    for (const trackId of Object.keys(progress.learned || {})) {
      const t = getTrack(trackId)
      if (!t) continue
      for (const it of t.items) learnedSet.add(it[1])
    }

    const stat = (word: string): St => {
      if (progress.wrong[word]) return 'bad'
      const e = recent.get(word)
      if (!e) return learnedSet.has(word) ? 'learned' : 'new'
      if (e.streak >= 3) return 'master'
      return 'testing'
    }

    return { stat }
  }, [progress.history, progress.wrong, progress.learned])
}

export default function Mastery() {
  const { stat } = useMastery()
  const { progress } = useStore()

  const units = useMemo(
    () => Object.keys(UNIT_WORDS).sort().map(uid => ({
      uid,
      words: UNIT_WORDS[uid],
    })),
    [],
  )

  const extras = useMemo(
    () => WORDS.filter(w => !w.unit).sort((a, b) => a.dayNo - b.dayNo).map(w => w.word),
    [],
  )

  const counts = useMemo(() => {
    const all = [...Object.values(UNIT_WORDS).flat(), ...extras]
    const c: Record<St, number> = { new: 0, learned: 0, testing: 0, master: 0, bad: 0 }
    for (const w of all) c[stat(w)] += 1
    return { c, total: all.length }
  }, [stat, extras])

  const speak = (w: string) => { void playWordText(w, 0.9) }

  const seg = (s: St) => {
    const n = counts.c[s]
    return counts.total ? (n / counts.total) * 100 : 0
  }

  return (
    <Shell title="掌握度地图" back sub="每个词现在的真实状态">
      {/* 总览 */}
      <div className="hero" style={{ marginBottom: 14 }}>
        <div className="lv">🗺️ 全部词 · {counts.total} 个</div>
        <div className="nm">
          已掌握 {counts.c.master} · 巩固中 {counts.c.testing} · 要攻错 {counts.c.bad}
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 12 }}>
          {ORDER.map(s => (
            counts.c[s] > 0 && (
              <div key={s} style={{ width: `${seg(s)}%`, background: ST_META[s].bg }} title={`${ST_META[s].label} ${counts.c[s]}`} />
            )
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10 }}>
          {ORDER.map(s => (
            <span key={s} className="sub" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 10, height: 10, borderRadius: 3, background: ST_META[s].bg, display: 'inline-block' }} />
              {ST_META[s].label} {counts.c[s]}
            </span>
          ))}
        </div>
      </div>

      {/* 七个单元 + 每日补充词 */}
      {[...units, { uid: 'extra', words: extras }].map(g => {
        if (!g.words.length) return null
        const c: Record<St, number> = { new: 0, learned: 0, testing: 0, master: 0, bad: 0 }
        for (const w of g.words) c[stat(w)] += 1
        const pct = g.words.length ? Math.round((c.master / g.words.length) * 100) : 0
        const isExtra = g.uid === 'extra'
        return (
          <div className="card pad" key={g.uid} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {isExtra ? '📌 每日补充词' : `📖 ${g.uid.replace('unit', 'Unit ')}`}
                <span className="sub small" style={{ marginLeft: 8, fontWeight: 400 }}>{g.words.length} 词</span>
              </div>
              <span className="sub small">掌握 {pct}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginTop: 8 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#97c459' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {g.words.map(w => {
                const s = stat(w)
                const m = ST_META[s]
                const cn = WORD_MAP[w]?.cn || ''
                return (
                  <button
                    key={w}
                    onClick={() => speak(w)}
                    title={cn ? `${w} · ${cn}（点击发音）` : `${w}（点击发音）`}
                    style={{
                      background: m.bg, color: m.fg, border: 'none', borderRadius: 8,
                      padding: '4px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="tip" style={{ marginBottom: 40 }}>
        灰色是还没测过的词，蓝色是学过但没测过；黄色测过还没稳，连对 3 次变绿（掌握）；
        红色在错词本里。点任意单词可以听发音。
      </div>
    </Shell>
  )
}
