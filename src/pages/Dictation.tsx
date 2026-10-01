import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { getTrack, loadAudioIndex, tuplesToItems } from '../lib/data'
import { playWord, stopAll, speakWord, prefetchAhead } from '../lib/player'
import { seededShuffle, makeSeed, newSalt } from '../lib/shuffle'
import { sharePoster } from '../lib/poster'
import { todayStr } from '../lib/storage'
import type { AnswerRecord, AudioItem } from '../types'

/** 秒 → 中文时长 */
function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const ss = s % 60
  return m ? `${m}分${ss}秒` : `${ss}秒`
}

export default function Dictation() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, recordAnswer, submitSession, updateSettings, profile } = useStore()
  const track = getTrack(id)

  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'ask' | 'done'>('ask')
  const [visible, setVisible] = useState(false)   // 是否已显示释义（防泄题：先听后看）
  const [result, setResult] = useState<{ score: number; right: number; total: number; newly: unknown[]; seconds: number } | null>(null)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [playing, setPlaying] = useState(false)
  const [items, setItems] = useState<AudioItem[]>(() => track ? tuplesToItems(track.items) : [])
  const [salt, setSalt] = useState('')            // 手动重新洗牌的扰动
  const startedAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)

  // 加载音频索引（带逐词 mp3 文件名），并按种子洗牌（防规律）
  useEffect(() => {
    if (!track) return
    let cancel = false
    loadAudioIndex().then(idxMap => {
      if (cancel) return
      const fromAudio = idxMap[track.id]
      let list: AudioItem[] = items
      if (fromAudio && fromAudio.length) {
        // 用音频清单里的条目（含 file），保留原始中文
        list = fromAudio.map((a, i) => ({
          no: a.no ?? i + 1,
          word: a.word,
          cn: a.cn || track.items[i]?.[2] || '',
          file: a.file,
        }))
      }
      // 随机出题：同一天同一人顺序稳定；不同天/不同人顺序不同
      if (progress.settings.shuffle && list.length > 1) {
        const seed = makeSeed(todayStr(), profile.id, track.id, salt)
        list = seededShuffle(list, seed)
      }
      setItems(list)
      setReady(true)
    })
    return () => { cancel = true }
    // 故意不依赖 items，避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, profile.id, salt])

  /** 重新洗牌：换顺序，重新开始 */
  const reshuffle = () => {
    if (!track) return
    setSalt(newSalt())
    setIdx(0)
    setInput('')
    setPhase('ask')
    setAnswers([])
    startedAt.current = Date.now()
    window.scrollTo({ top: 0 })
  }

  const cur = items[idx]

  // 每进入一题，自动播报
  useEffect(() => {
    if (!cur || phase !== 'ask') return
    let cancelled = false
    ;(async () => {
      setVisible(false)
      setPlaying(true)
      // 提前缓冲后面几题，减少等待
      prefetchAhead(items, idx, 3)
      await new Promise(r => setTimeout(r, 250))
      if (cancelled) return
      const rep = Math.max(1, progress.settings.repeat)
      for (let i = 0; i < rep; i++) {
        if (cancelled) return
        await playWord(cur, progress.settings.rate)
        if (i < rep - 1) await new Promise(r => setTimeout(r, 700))
      }
      if (!cancelled) setPlaying(false)
    })()
    return () => { cancelled = true; stopAll() }
  }, [idx, cur, phase])

  // 自动聚焦
  useEffect(() => {
    if (phase === 'ask') setTimeout(() => inputRef.current?.focus(), 100)
  }, [idx, phase, visible])

  const pct = items.length ? Math.round(((idx + (phase === 'done' ? 1 : 0)) / items.length) * 100) : 0

  const replay = async (slow = false) => {
    if (!cur) return
    setPlaying(true)
    await playWord(cur, slow ? progress.settings.rate * 0.7 : progress.settings.rate)
    setPlaying(false)
  }

  const showMeaning = () => {
    setVisible(true)
    speakWord(cur.word, 0.9)
  }

  const submit = () => {
    if (!cur) return
    const ok = judge(input, cur.word)
    const rec: AnswerRecord = { no: cur.no, word: cur.word, cn: cur.cn, input, correct: ok }
    recordAnswer(cur.word, cur.cn, input, ok)
    setAnswers(a => [...a, rec])
    setPhase('done')
  }

  const next = () => {
    if (idx + 1 >= items.length) {
      finish()
      return
    }
    setIdx(i => i + 1)
    setInput('')
    setPhase('ask')
  }

  const finish = () => {
    if (!track) return
    const recs = answers
    const total = recs.length
    const right = recs.filter(r => r.correct).length
    const score = total ? Math.round((right / total) * 100) : 0
    const sec = Math.round((Date.now() - startedAt.current) / 1000)
    const { newly } = submitSession(track, recs, sec)
    setResult({ score, right, total, newly, seconds: sec })
    setPhase('done')
  }

  if (!track) return <Shell title="未找到" back><div className="empty"><div className="i">🤔</div><div>没有这个任务</div></div></Shell>

  // ── 结果页 ──
  if (result) {
    return <ResultView track={track} result={result} answers={answers} profile={profile} onHome={() => nav('/')} />
  }

  const lastRec = answers[answers.length - 1]
  const cardStyle = lastRec ? (lastRec.correct ? 'ok' : 'bad') : ''

  return (
    <Shell
      title={track.label || `第 ${track.order} 天`}
      back
      sub={`${idx + 1}/${items.length}`}
      noNav
    >
      <div className="qbar">
        <div className="qhead">
          <span>进度 <b>{idx + 1}</b> / {items.length}</span>
          <span>🎯 得分 {answers.filter(a => a.correct).length * 10}</span>
        </div>
        <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          {progress.settings.shuffle && (
            <button className="btn ghost sm" onClick={reshuffle} style={{ fontSize: 12 }}>
              🔀 换个顺序
            </button>
          )}
          <a className="btn ghost sm" style={{ fontSize: 12 }} href={`#/print/${track.id}`}>🖨️ 打纸质卷</a>
        </div>
      </div>

      <div className="playbox">
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>第 {cur.no} 题 · 听音频写单词</div>
        <button
          className={'bigplay' + (playing ? ' playing' : '')}
          onClick={() => replay(false)}
          aria-label="重播"
        >{playing ? '♪' : '🔊'}</button>
        <div style={{ fontSize: 12, color: 'var(--sub)' }}>
          点 🔊 重播 · 已播 {progress.settings.repeat} 遍
        </div>

        {visible ? (
          <div className="cn" style={{ marginTop: 14 }}>
            {cur.cn}
            <div className="hint">↑ 中文释义（提示）</div>
          </div>
        ) : (
          <button className="btn ghost sm" style={{ margin: '14px auto 0', display: 'inline-flex' }} onClick={showMeaning}>
            💡 没听清？看中文提示
          </button>
        )}
      </div>

      <div className="answerrow">
        <input
          ref={inputRef}
          className={phase === 'done' ? cardStyle : ''}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              phase === 'ask' ? submit() : next()
            }
          }}
          placeholder="在这里写英文…"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={phase === 'done'}
        />
        {phase === 'ask'
          ? <button className="sub btn" onClick={submit} disabled={!input.trim()}>确认</button>
          : <button className="sub btn ok" onClick={next}>下一题</button>}
      </div>

      {phase === 'done' && lastRec && (
        <div className={'verdict ' + (lastRec.correct ? 'ok' : 'bad')}>
          {lastRec.correct ? (
            <>✓ 答对了</>
          ) : (
            <>
              正确答案
              <span className="ans">{cur.word}</span>
              {lastRec.input && <span style={{ fontSize: 13, fontWeight: 400 }}>你写的是「{lastRec.input}」</span>}
            </>
          )}
        </div>
      )}

      <div className="controls">
        <button className="btn ghost" onClick={() => { setIdx(i => Math.max(0, i - 1)); setInput(''); setPhase('ask') }} disabled={idx === 0}>‹ 上一题</button>
        <button className="btn ghost" onClick={() => replay(true)}>🐢 慢速</button>
        <button className="btn ghost" onClick={() => { setPhase('done'); if (!answers.some(a => a.no === cur.no)) { const rec = { no: cur.no, word: cur.word, cn: cur.cn, input, correct: false }; recordAnswer(cur.word, cur.cn, input, false); setAnswers(a => [...a, rec]) } }}>跳过</button>
      </div>

      <div className="center mt">
        <button className="btn ghost sm" onClick={finish}>结束并交卷</button>
      </div>
    </Shell>
  )
}

function ResultView({ track, result, answers, profile, onHome }: {
  track: ReturnType<typeof getTrack>
  result: { score: number; right: number; total: number; newly: unknown[]; seconds: number }
  answers: AnswerRecord[]
  profile: { id: string; name: string; emoji: string; color: string }
  onHome: () => void
}) {
  const nav = useNavigate()
  const wrongs = answers.filter(a => !a.correct)
  const emoji = result.score === 100 ? '🏆' : result.score >= 90 ? '🎉' : result.score >= 70 ? '👍' : result.score >= 50 ? '💪' : '📖'
  const word = result.score === 100 ? '完美通关！' : result.score >= 90 ? '太棒了！' : result.score >= 70 ? '不错，继续加油' : result.score >= 50 ? '还差一点' : '多练几遍就熟了'

  return (
    <Shell title="听写结果" back noNav>
      <div className="card">
        <div className="scorebig">
          <div className="emoji">{emoji}</div>
          <div className="num">{result.score}<span style={{ fontSize: 26 }}>%</span></div>
          <div className="lab">{word}</div>
          <div className="lab" style={{ marginTop: 8 }}>
            答对 <b style={{ color: 'var(--ok)' }}>{result.right}</b> / {result.total} 题
            {' · '}答错 <b style={{ color: 'var(--bad)' }}>{result.total - result.right}</b> 题
            {' · '}用时 {fmtSec(result.seconds)}
          </div>
        </div>
      </div>

      {/* 家长微信分享 */}
      <div className="row" style={{ gap: 10 }}>
        <button
          className="btn"
          style={{ background: '#07c160' }}
          onClick={() => sharePoster({
            profile, trackLabel: track?.label || track?.id || '', date: todayStr(),
            score: result.score, right: result.right, total: result.total, seconds: result.seconds,
            answers: answers.map(a => ({ word: a.word, cn: a.cn, correct: a.correct, input: a.input })),
          })}
        >
          📤 生成成绩海报（发微信）
        </button>
      </div>

      {(result.newly as { icon: string; name: string }[]).length > 0 && (
        <div className="card pad" style={{ borderColor: '#f0dc9a' }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🎊 解锁新成就</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {(result.newly as { id: string; icon: string; name: string }[]).map(b => (
              <span key={b.id} className="pill p-gold" style={{ fontSize: 13, padding: '5px 12px' }}>
                {b.icon} {b.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {wrongs.length > 0 ? (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            ❌ 错词 {wrongs.length} 个
            <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>已自动进错词本</span>
          </div>
          <div className="reviewlist">
            {wrongs.map(a => (
              <div key={a.no} className="rv">
                <span className="mk">✗</span>
                <span className="w">{a.word}</span>
                <span className="sub small">{a.cn}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card pad center" style={{ background: 'var(--ok-soft)' }}>
          <div style={{ fontSize: 30 }}>✨</div>
          <div style={{ fontWeight: 800, color: 'var(--ok)' }}>全部答对，零错词！</div>
        </div>
      )}

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>全部题目</div>
        <div className="reviewlist">
          {answers.map(a => (
            <div key={a.no} className="rv">
              <span className="mk">{a.correct ? '✓' : '✗'}</span>
              <span className="w">{a.word}</span>
              {!a.correct && a.input && <span className="mine">{a.input}</span>}
              <span className="sub small" style={{ marginLeft: 'auto' }}>{a.cn}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost" onClick={() => location.reload()}>🔁 再练一遍</button>
        <button className="btn" onClick={onHome}>回首页</button>
      </div>
      <div className="center mt">
        <button className="btn ghost sm" onClick={() => nav('/review')}>去错词本看看 →</button>
      </div>
    </Shell>
  )
}
