import { useState, useMemo } from 'react'
import Shell from '../components/Shell'
import { WORDS, UNITS, UNIT_WORDS } from '../lib/data'
import { speakWord } from '../lib/player'
import { useStore } from '../lib/store'

export default function Words() {
  const { progress } = useStore()
  const [q, setQ] = useState('')
  const [unit, setUnit] = useState<string>('all')

  const list = useMemo(() => {
    let l = WORDS
    if (unit !== 'all') {
      const set = new Set(UNIT_WORDS[unit] || [])
      l = l.filter(w => set.has(w.word))
    }
    if (q.trim()) {
      const k = q.trim().toLowerCase()
      l = l.filter(w => w.word.toLowerCase().includes(k) || w.cn.includes(k))
    }
    return l
  }, [q, unit])

  return (
    <Shell title="词库" sub={`${WORDS.length} 词`}>
      <div className="card pad" style={{ padding: 12 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜单词或中文意思…"
          style={{
            width: '100%', padding: '11px 14px', border: '2px solid var(--line)',
            borderRadius: 10, fontSize: 15, outline: 'none', background: '#fff',
          }}
        />
      </div>

      <div className="tabs">
        <button className={unit === 'all' ? 'on' : ''} onClick={() => setUnit('all')}>全部</button>
        {UNITS.map(u => (
          <button key={u.id} className={unit === u.id ? 'on' : ''} onClick={() => setUnit(u.id)}>
            Unit {String(u.order).padStart(2, '0')}
          </button>
        ))}
      </div>

      <div className="sub small" style={{ marginBottom: 8 }}>共 {list.length} 个词</div>

      <div className="card">
        {list.map(w => {
          const bad = progress.wrong[w.word]
          return (
            <div key={w.word} className="pad" style={{
              borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
            }}>
              <button onClick={() => speakWord(w.word)} style={{ fontSize: 18, width: 32 }} aria-label="朗读">🔊</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {w.word}
                  {w.pos && <span className="sub small" style={{ marginLeft: 6, fontStyle: 'italic' }}>{w.pos}</span>}
                </div>
                <div className="sub small">{w.cn}</div>
              </div>
              {bad && <span className="pill p-bad">错{bad.count}</span>}
              <span className="pill p-blue">D{w.dayNo}</span>
            </div>
          )
        })}
        {list.length === 0 && <div className="empty"><div className="i">🔍</div><div>没找到匹配的词</div></div>}
      </div>
    </Shell>
  )
}
