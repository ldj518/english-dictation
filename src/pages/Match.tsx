import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { loadBookWords, playWordText } from '../lib/data'
import { resolveRate } from '../lib/player'
import { currentBooks } from '../lib/api'

/** 词义连连看：学过的词 ∪ 错词本，抽 6 对英中卡配对消除。 */
interface Card { pairId: string; kind: 'en' | 'cn'; label: string }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const PAIRS = 6
const BONUS_COMBO = 3 // 连击达到 3 开始每次额外 +5

export default function Match() {
  const nav = useNavigate()
  const { progress, profile, addPoints } = useStore()

  const [cards, setCards] = useState<Card[]>([])
  const [sel, setSel] = useState<Card | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [shake, setShake] = useState<string | null>(null)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [score, setScore] = useState(0)
  const [poolNote, setPoolNote] = useState('')
  const [done, setDone] = useState(false)
  const doneAt = useRef(0)
  const startedAt = useRef(Date.now())

  const rate = resolveRate(false, progress.settings.rate)

  // 开一局：学过的词 ∪ 错词本，不足 6 对用今日计划词预习
  useEffect(() => {
    let cancel = false
    void loadBookWords().then(book => {
      if (cancel) return
      const n = Math.max(3, currentBooks()?.dailyWords || 10)
      const learned = book.words.slice(0, Math.min(book.words.length, progress.planDone * n))
      const pool = new Map<string, { word: string; cn: string }>()
      for (const w of learned) pool.set(w.word.toLowerCase(), w)
      for (const [w] of Object.entries(progress.wrong)) {
        const hit = book.byKey.get(w.toLowerCase())
        if (hit) pool.set(hit.word.toLowerCase(), hit)
      }
      let arr = [...pool.values()]
      if (arr.length < PAIRS) {
        arr = book.words.slice(0, PAIRS)   // 刚开垦阶段：拿第一批词预习
        setPoolNote('词池还没攒够，先用今天要学的词预习')
      } else {
        setPoolNote(`从学过的 ${arr.length} 词里抽 ${PAIRS} 对`)
      }
      const picked = shuffle(arr).slice(0, PAIRS)
      const cs: Card[] = []
      for (const w of picked) {
        cs.push({ pairId: w.word, kind: 'en', label: w.word })
        cs.push({ pairId: w.word, kind: 'cn', label: w.cn || w.word })
      }
      setCards(shuffle(cs))
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.planDone])

  const restart = () => {
    setMatched(new Set()); setSel(null); setCombo(0); setMaxCombo(0)
    setScore(0); setDone(false); setShake(null)
    startedAt.current = Date.now(); doneAt.current = 0
    // 重洗当前 cards 的词
    const en = cards.filter(c => c.kind === 'en')
    const cs: Card[] = []
    for (const e of en) {
      cs.push(e)
      const cn = cards.find(c => c.kind === 'cn' && c.pairId === e.pairId)
      if (cn) cs.push(cn)
    }
    setCards(shuffle(cs))
  }

  const tap = (c: Card) => {
    if (matched.has(c.pairId) || done) return
    if (c.kind === 'en') {
      void playWordText(c.label, rate)
      setSel(c)
      return
    }
    // 中文卡
    if (!sel) { setSel(c); return }
    if (sel.pairId === c.pairId) {
      // 配对成功
      const nm = new Set(matched); nm.add(c.pairId); setMatched(nm)
      const nc = combo + 1
      setCombo(nc)
      setMaxCombo(m => Math.max(m, nc))
      setScore(s => s + 10 + (nc >= BONUS_COMBO ? 5 : 0))
      setSel(null)
      if (nm.size >= PAIRS) {
        doneAt.current = Date.now()
        setDone(true)
        // 结算积分：基础 + 连击奖励
        const finalScore = score + 10 + (nc >= BONUS_COMBO ? 5 : 0)
        addPoints(finalScore)
      }
    } else {
      setCombo(0)
      setShake(c.pairId)
      setTimeout(() => setShake(null), 350)
      setSel(null)
    }
  }

  const usedSec = doneAt.current ? Math.round((doneAt.current - startedAt.current) / 1000) : 0

  return (
    <Shell title="词义连连看" back sub={done ? undefined : `配对 ${matched.size}/${PAIRS}`}>
      {poolNote && !done && (
        <div className="sub small center" style={{ marginBottom: 10 }}>{poolNote} · 点英文听读音，再点它的中文</div>
      )}

      {done ? (
        <div className="card pad center">
          <div style={{ fontSize: 34 }}>🧩</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 6 }}>全部配对！</div>
          <div className="sub" style={{ marginTop: 6 }}>
            得分 <b style={{ color: 'var(--ok)' }}>{score}</b> · 最高连击 <b>{maxCombo}</b>
            {' · '}用时 {Math.floor(usedSec / 60)}分{usedSec % 60}秒
          </div>
          <div className="sub small" style={{ marginTop: 4 }}>积分已加到 {profile.name} 的等级里</div>
          <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'center' }}>
            <button className="btn" style={{ background: 'var(--blue)' }} onClick={restart}>再来一局</button>
            <button className="btn ghost" onClick={() => nav('/games')}>回游戏中心</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {cards.map(c => {
            const ok = matched.has(c.pairId)
            const bad = shake === c.pairId
            const on = sel?.pairId === c.pairId && sel.kind === c.kind
            return (
              <button
                key={c.kind + c.pairId}
                onClick={() => tap(c)}
                style={{
                  minHeight: 56, borderRadius: 12, padding: '8px 4px', fontSize: c.kind === 'en' ? 15 : 13,
                  fontWeight: c.kind === 'en' ? 700 : 500,
                  border: '2px solid ' + (ok ? 'transparent' : on ? 'var(--blue)' : bad ? 'var(--bad)' : '#e4e8f0'),
                  background: ok ? 'var(--ok-soft)' : bad ? '#ffe3e3' : c.kind === 'en' ? '#f3f7ff' : '#fff',
                  opacity: ok ? 0.35 : 1,
                  transform: bad ? 'translateX(3px)' : undefined,
                  transition: 'opacity .3s',
                  color: 'var(--text, #1a1a2e)',
                  lineHeight: 1.25,
                  wordBreak: 'break-word',
                  cursor: ok ? 'default' : 'pointer',
                }}
              >{c.kind === 'en' ? '🔊 ' + c.label : c.label}</button>
            )
          })}
        </div>
      )}

      {!done && (
        <div className="qhead" style={{ marginTop: 14 }}>
          <span>🎯 {score} 分</span>
          <span>{combo >= BONUS_COMBO ? `🔥 连击 x${combo}` : `连击 ${combo}`}</span>
        </div>
      )}
    </Shell>
  )
}
