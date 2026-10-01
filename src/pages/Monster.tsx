import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { playWordText, WORDS } from '../lib/data'
import { resolveRate } from '../lib/player'
import LetterKeyboard from '../components/LetterKeyboard'
import type { WrongWord } from '../types'

/**
 * 错词大作战：错题本里的词当怪兽，答对一只消灭一只。
 * 复习的游戏化皮肤——答题直接走 recordReview（答对推进遗忘曲线/毕业出本，
 * 答错重置回错词本），与「错词本复习」同一条数据通路，不另记账。
 *
 * 防泄题：听音选义只出读音+中文选项；看中拼英只出中文，英文答案不上屏。
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Monster() {
  const nav = useNavigate()
  const { progress, recordReview } = useStore()
  const rate = resolveRate(false, progress.settings.rate)
  /** 内置 26 键键盘（默认开） */
  const kb = progress.settings.kbBuiltIn !== false

  // 队列：错得多的先变成怪（快照，答题不改动队列本身）
  const [queue, setQueue] = useState<WrongWord[]>(() =>
    shuffle(Object.values(progress.wrong))
  )
  const [phase, setPhase] = useState<'ask' | 'boom' | 'miss'>('ask')
  const [picked, setPicked] = useState('')
  const [input, setInput] = useState('')
  const [input2, setInput2] = useState('')   // 答错展示用
  const [killed, setKilled] = useState(0)
  const [missed, setMissed] = useState(0)
  const [round, setRound] = useState(0)      // 展示用轮次（打偏会复现）
  const startedAt = useRef(Date.now())
  const playToken = useRef(0)

  const cur = queue[0]
  const done = !cur
  const type: 'e2c' | 'c2e' = round % 2 === 0 ? 'e2c' : 'c2e'

  // 进题自动播读音（e2c 必播；c2e 不自动播——读音即答案，孩子按需点提示）
  useEffect(() => {
    if (!cur || phase !== 'ask' || type !== 'e2c') return
    let cancelled = false
    const token = ++playToken.current
    ;(async () => {
      await new Promise(r => setTimeout(r, 250))
      if (!cancelled && token === playToken.current) void playWordText(cur.word, rate)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, cur?.word, phase])

  // 干扰项：队列里其他怪的中文，不够从内置词表随机补
  const opts = useMemo(() => {
    if (!cur || type !== 'e2c') return []
    const pool = shuffle(queue.filter(w => w.word !== cur.word && w.cn !== cur.cn).map(w => w.cn))
      .filter(c => c)
    let i = 0
    while (pool.length < 3 && i < WORDS.length) {
      const c = WORDS[i++].cn
      if (c !== cur.cn && !pool.includes(c)) pool.push(c)
    }
    return shuffle([cur.cn, ...pool.slice(0, 3)])
  }, [cur, type, queue])

  /** 消灭 / 打偏 后的共同推进：消灭则出队，打偏则排到队尾 */
  const advance = (killedIt: boolean) => {
    setPicked(''); setInput(''); setInput2('')
    setPhase('ask')
    setQueue(q => {
      if (killedIt || q.length <= 1) return q.slice(1)
      const [head, ...rest] = q
      return [...rest, head]
    })
    setRound(r => r + 1)
  }

  const kill = () => {
    if (!cur) return
    setKilled(k => k + 1)
    recordReview(cur.word, cur.cn, true)
    setPhase('boom')
    void playWordText(cur.word, rate)
    setTimeout(() => advance(true), 900)
  }

  const miss = (showInput: string) => {
    if (!cur) return
    setMissed(m => m + 1)
    setInput2(showInput)
    recordReview(cur.word, cur.cn, false)
    setPhase('miss')
    setTimeout(() => advance(false), 1600)
  }

  const pick = (cn: string) => {
    if (phase !== 'ask' || !cur) return
    setPicked(cn)
    if (cn === cur.cn) kill()
    else miss('')
  }

  const submitTyping = () => {
    if (phase !== 'ask' || !cur) return
    if (judge(input, cur.word)) kill()
    else miss(input)
  }

  /* ── 结算 / 空状态 ── */
  if (done) {
    const sec = Math.round((Date.now() - startedAt.current) / 1000)
    return (
      <Shell title="错词大作战" back noNav>
        <div className="card pad center">
          <div style={{ fontSize: 34 }}>{killed > 0 ? '🏆' : '👾'}</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 6 }}>
            {killed > 0 ? `歼灭 ${killed} 只怪兽！` : '错题本空空的'}
          </div>
          {killed > 0 && (
            <div className="sub" style={{ marginTop: 6 }}>
              打偏 {missed} 次 · 用时 {Math.floor(sec / 60)}分{sec % 60}秒
            </div>
          )}
          <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
            {killed > 0
              ? '消灭的词已推进复习进度，连对几次就彻底出本了'
              : '先去听写攒几只怪兽再来'}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'center' }}>
            <button className="btn" style={{ background: 'var(--blue)' }} onClick={() => location.reload()}>
              🔁 再战一局
            </button>
            <button className="btn ghost" onClick={() => nav('/games')}>回游戏中心</button>
          </div>
        </div>
      </Shell>
    )
  }

  const showBoom = phase === 'boom'
  const showMiss = phase === 'miss'

  return (
    <Shell title="错词大作战" back sub={`怪兽 ${round + 1}`}>
      <div className="qbar">
        <div className="qhead">
          <span>👾 已歼灭 <b>{killed}</b></span>
          <span>剩 {queue.length} 只</span>
        </div>
      </div>

      {/* 怪兽本体 */}
      <div className="playbox" style={showBoom ? { opacity: 0.35 } : undefined}>
        <div style={{ fontSize: 44 }}>
          {showBoom ? '💥' : '👾'}
        </div>
        <div className="sub small" style={{ marginTop: 6 }}>
          {type === 'e2c' ? '听读音，选对意思，消灭它！' : '看中文，拼出英文，消灭它！'}
          {cur.count > 1 && `（这只被它错过 ${cur.count} 次）`}
        </div>

        {type === 'e2c' ? (
          <>
            <button className="bigplay" onClick={() => cur && void playWordText(cur.word, rate)} aria-label="重播">🔊</button>
            <div className="optGrid">
              {opts.map(o => {
                const reveal = showBoom || showMiss
                const isPicked = picked === o
                const cls = reveal
                  ? (o === cur.cn ? 'opt right' : isPicked ? 'opt wrong' : 'opt dim')
                  : 'opt'
                return (
                  <button key={o} className={cls} onClick={() => pick(o)} disabled={phase !== 'ask'}>
                    {o}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div className="wordBig">{cur.cn}</div>
            <button className="btn ghost sm" style={{ margin: '8px auto 0', display: 'inline-flex' }}
              onClick={() => void playWordText(cur.word, rate)}>
              💡 听发音提示
            </button>
            <div className="answerrow">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyping() } }}
                placeholder="拼出英文…"
                inputMode={kb ? 'none' : 'text'}
                spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
                disabled={phase !== 'ask'}
              />
              <button className="sub btn" onClick={submitTyping} disabled={!input.trim() || phase !== 'ask'}>攻击！</button>
            </div>
            {kb && (
              <LetterKeyboard
                disabled={phase !== 'ask'}
                onKey={c => setInput(v => v + c)}
                onBackspace={() => setInput(v => v.slice(0, -1))}
                onSubmit={submitTyping}
              />
            )}
          </>
        )}
      </div>

      {(showBoom || showMiss) && (
        <div className={'verdict ' + (showBoom ? 'ok' : 'bad')}>
          {showBoom ? (
            <>💥 消灭了「{cur.word}」！</>
          ) : (
            <>打偏了 · 正确答案<span className="ans">{cur.word}</span>
              {input2 && <span style={{ fontSize: 13, fontWeight: 400 }}>你拼的是「{input2}」</span>}
              <span style={{ display: 'block', fontSize: 13, fontWeight: 400 }}>它跑到队尾了，一会儿再来</span>
            </>
          )}
        </div>
      )}
    </Shell>
  )
}
