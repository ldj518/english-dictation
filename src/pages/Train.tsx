import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { WORDS, loadAudioIndex, UNITS } from '../lib/data'
import { playWord, stopAll } from '../lib/player'
import { playWordText } from '../lib/data'
import LetterKeyboard from '../components/LetterKeyboard'
import { reportSession } from '../lib/api'
import type { AudioItem } from '../types'

type Game = 'flash' | 'sprint' | 'spell'

/**
 * 提升英语能力的训练场（三个模式）：
 *
 * flash  闪卡记忆：看中文 → 想英文 → 翻卡自评，按遗忘曲线自动排期
 * sprint 限时挑战：60 秒内听音写词，比谁写得快、写得对
 * spell  拼写纠错：给出错乱字母，拼回正确单词（练拼写手感）
 */
export default function Train() {
  const nav = useNavigate()
  const { progress, profile, recordAnswer, submitSession } = useStore()
  const [game, setGame] = useState<Game>('flash')

  return (
    <Shell title="训练场" back>
      <div className="seg" style={{ width: '100%', marginBottom: 14 }}>
        {([['flash', '🃏 闪卡'], ['sprint', '⚡ 限时'], ['spell', '🔤 拼写']] as [Game, string][]).map(([k, t]) => (
          <button key={k} className={game === k ? 'on' : ''} style={{ flex: 1 }} onClick={() => setGame(k)}>
            {t}
          </button>
        ))}
      </div>

      {game === 'flash' && <Flash />}
      {game === 'sprint' && <Sprint onExit={() => nav('/')} />}
      {game === 'spell' && <Spell onExit={() => nav('/')} />}
    </Shell>
  )
}

/* ═══════════ 1. 闪卡记忆 ═══════════ */

/** 闪卡：挑「最该复习」的词，看中文想英文，翻面自评 */
function Flash() {
  const { progress } = useStore()

  // 选词：优先错词本的到期词，其次未练过的
  const deck = useMemo(() => {
    const wrongWords = Object.values(progress.wrong)
    if (wrongWords.length) {
      return wrongWords.slice(0, 20).map(w => ({ word: w.word, cn: w.cn }))
    }
    return WORDS.slice(0, 20).map(w => ({ word: w.word, cn: w.cn }))
  }, [progress.wrong])

  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState(0)
  const cur = deck[i]

  useEffect(() => {
    setFlipped(false)
  }, [i])

  if (!cur) return <div className="card pad center sub">没有可练的词</div>

  const mark = (ok: boolean) => {
    if (ok) setKnown(k => k + 1)
    if (i + 1 >= deck.length) { setI(0); setKnown(0); return }
    setI(i + 1)
  }

  return (
    <>
      <div className="card pad center" style={{ minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="sub small" style={{ marginBottom: 10 }}>{i + 1} / {deck.length} · 已记住 {known}</div>
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.5 }}>{cur.cn}</div>
        {flipped ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ok)', letterSpacing: 1 }}>{cur.word}</div>
            <button className="btn ghost sm" style={{ marginTop: 10 }}
              onClick={() => { void playWordText(cur.word, 0.85) }}>🔊 听发音</button>
          </div>
        ) : (
          <button className="btn" style={{ marginTop: 24, maxWidth: 220 }}
            onClick={() => setFlipped(true)}>👆 想好了，翻卡</button>
        )}
      </div>

      {flipped && (
        <div className="row" style={{ gap: 10 }}>
          <button className="btn ghost" style={{ flex: 1, borderColor: 'var(--bad)', color: 'var(--bad)' }}
            onClick={() => mark(false)}>😵 没记住</button>
          <button className="btn" style={{ flex: 1, background: 'var(--ok)' }}
            onClick={() => mark(true)}>😎 记住了</button>
        </div>
      )}
      <div className="center mt sub small">
        闪卡按错词本优先级排序，记住的会慢慢降低出现频率
      </div>
    </>
  )
}

/* ═══════════ 2. 限时挑战 ═══════════ */

function Sprint({ onExit }: { onExit: () => void }) {
  const { profile, submitSession, recordAnswer, progress } = useStore()
  /** 内置 26 键键盘（默认开）：杜绝输入法联想把整词弹出来 */
  const kb = progress.settings.kbBuiltIn !== false
  const [phase, setPhase] = useState<'ready' | 'run' | 'end'>('ready')
  const [left, setLeft] = useState(60)
  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [recs, setRecs] = useState<{ no: number; word: string; cn: string; input: string; correct: boolean }[]>([])
  const [items, setItems] = useState<AudioItem[]>([])
  const [flash, setFlash] = useState<'ok' | 'bad' | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 载入音频索引，做成一个足够长的题池
  useEffect(() => {
    loadAudioIndex().then(m => {
      const all: AudioItem[] = []
      for (const k of Object.keys(m)) all.push(...m[k])
      // 去重（同一单词只留一个）
      const seen = new Set<string>()
      const uniq = all.filter(a => (seen.has(a.word) ? false : (seen.add(a.word), true)))
      setItems(uniq)
    })
  }, [])

  // 倒计时
  useEffect(() => {
    if (phase !== 'run') return
    const t = setInterval(() => {
      setLeft(l => {
        if (l <= 1) { setPhase('end'); return 0 }
        return l - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase])

  const cur = items[idx]

  useEffect(() => {
    if (phase === 'run' && cur) setTimeout(() => inputRef.current?.focus(), 80)
  }, [idx, phase, cur])

  const start = () => {
    setPhase('run'); setLeft(60); setIdx(0); setRecs([]); setInput('')
  }

  const submit = () => {
    if (!cur) return
    const ok = judge(input, cur.word)
    const rec = { no: recs.length + 1, word: cur.word, cn: cur.cn, input, correct: ok }
    setRecs(r => [...r, rec])
    recordAnswer(cur.word, cur.cn, input, ok)
    setFlash(ok ? 'ok' : 'bad')
    setTimeout(() => setFlash(''), 260)
    setInput('')
    setIdx(i => i + 1)
  }

  useEffect(() => {
    if (phase === 'end') {
      stopAll()
      const total = recs.length
      if (total) {
        submitSession(
          { id: 'train-sprint', kind: 'daily', group: 'daily', order: 0, label: '限时挑战',
            file: '', seconds: 60, wordCount: total, sections: [], items: [] },
          recs, 60
        )
        reportSession({
          studentId: profile.id, trackId: 'train-sprint', trackLabel: '限时挑战 60 秒',
          kind: 'daily', mode: 'online', seconds: 60, records: recs,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const rightCount = recs.filter(r => r.correct).length

  if (phase === 'ready') {
    return (
      <div className="card pad center">
        <div style={{ fontSize: 44 }}>⚡</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>60 秒限时挑战</div>
        <div className="sub small" style={{ margin: '8px 0 18px', lineHeight: 1.7 }}>
          60 秒内听音写单词，写得越多越准越好。<br />
          挑战一次 = 一次练习记录，会计入统计。
        </div>
        <button className="btn" onClick={start} disabled={!items.length} style={{ maxWidth: 240 }}>
          {items.length ? '▶ 开始挑战' : '加载中…'}
        </button>
      </div>
    )
  }

  if (phase === 'end') {
    return (
      <>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{rightCount >= 15 ? '🏆' : rightCount >= 10 ? '🎉' : '💪'}</div>
            <div className="num">{rightCount}<span style={{ fontSize: 24 }}> 个</span></div>
            <div className="lab">60 秒答对 {rightCount} / {recs.length}</div>
          </div>
        </div>
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>本次作答</div>
          <div className="reviewlist">
            {recs.map(r => (
              <div key={r.no} className="rv">
                <span className="mk">{r.correct ? '✓' : '✗'}</span>
                <span className="w">{r.word}</span>
                {!r.correct && r.input && <span className="mine">{r.input}</span>}
                <span className="sub small" style={{ marginLeft: 'auto' }}>{r.cn}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={start}>🔁 再来一次</button>
          <button className="btn" style={{ flex: 1 }} onClick={onExit}>完成</button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="card pad center" style={{ borderColor: left <= 10 ? 'var(--bad)' : undefined }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: left <= 10 ? 'var(--bad)' : 'var(--blue)' }}>
          {left}<span style={{ fontSize: 16 }}>s</span>
        </div>
        <div className="sub small">已答对 {rightCount} / {recs.length}</div>
      </div>

      <div className={'playbox' + (flash ? ' flash-' + flash : '')}>
        <button className="bigplay" onClick={() => cur && playWord(cur, 1)}>🔊</button>
        <div className="sub small" style={{ marginTop: 6 }}>听发音，快速写单词</div>
      </div>

      <div className="answerrow">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder="快速写…"
          inputMode={kb ? 'none' : 'text'}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        />
        <button className="sub btn" onClick={submit} disabled={!input.trim()}>确</button>
      </div>

      {kb && (
        <LetterKeyboard
          onKey={c => setInput(v => v + c)}
          onBackspace={() => setInput(v => v.slice(0, -1))}
          onSubmit={submit}
        />
      )}
    </>
  )
}

/* ═══════════ 3. 拼写纠错 ═══════════ */

function Spell({ onExit }: { onExit: () => void }) {
  const { progress } = useStore()
  const kb = progress.settings.kbBuiltIn !== false
  const [i, setI] = useState(0)
  const [input, setInput] = useState('')
  const [show, setShow] = useState(false)
  const [ok, setOk] = useState(0)

  const deck = useMemo(() => {
    const pool = Object.keys(progress.wrong).length
      ? Object.values(progress.wrong).map(w => ({ word: w.word, cn: w.cn }))
      : WORDS.slice(0, 25).map(w => ({ word: w.word, cn: w.cn }))
    return pool.slice(0, 25)
  }, [progress.wrong])

  const cur = deck[i]
  if (!cur) return <div className="card pad center sub">没有可练的词</div>

  // 打乱字母（保留首尾，中间乱序，更像真实拼写困难）
  const scrambled = useMemo(() => {
    const w = cur.word
    if (w.length <= 3) return w.split('').reverse().join('')
    const mid = w.slice(1, -1).split('')
    for (let k = mid.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1))
      ;[mid[k], mid[j]] = [mid[j], mid[k]]
    }
    return w[0] + mid.join('') + w[w.length - 1]
  }, [cur.word])

  const check = () => {
    const correct = judge(input, cur.word)
    if (correct) setOk(o => o + 1)
    setShow(true)
  }

  const next = () => {
    setShow(false); setInput('')
    if (i + 1 >= deck.length) { setI(0); setOk(0); return }
    setI(i + 1)
  }

  return (
    <>
      <div className="card pad center">
        <div className="sub small">{i + 1} / {deck.length} · 答对 {ok}</div>
        <div style={{ fontSize: 15, marginTop: 10, color: 'var(--sub)' }}>{cur.cn}</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 5, marginTop: 14, color: 'var(--purple)' }}>
          {scrambled}
        </div>
        <div className="sub small" style={{ marginTop: 8 }}>↑ 字母打乱了，拼回正确单词</div>
      </div>

      <div className="answerrow">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); show ? next() : check() } }}
          placeholder="拼写…"
          inputMode={kb ? 'none' : 'text'}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          disabled={show}
        />
        {show
          ? <button className="sub btn ok" onClick={next}>下一题</button>
          : <button className="sub btn" onClick={check} disabled={!input.trim()}>确认</button>}
      </div>

      {kb && (
        <LetterKeyboard
          disabled={show}
          onKey={c => setInput(v => v + c)}
          onBackspace={() => setInput(v => v.slice(0, -1))}
          onSubmit={() => (show ? next() : check())}
        />
      )}

      {show && (
        <div className={'verdict ' + (judge(input, cur.word) ? 'ok' : 'bad')}>
          {judge(input, cur.word) ? '✓ 拼对了' : <>正确拼写<span className="ans">{cur.word}</span></>}
        </div>
      )}

      <div className="center mt">
        <button className="btn ghost sm" onClick={onExit}>退出</button>
      </div>
    </>
  )
}
