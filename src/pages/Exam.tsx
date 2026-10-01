import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { getTrack, loadAudioIndex, tuplesToItems } from '../lib/data'
import { playWord, stopAll } from '../lib/player'
import { seededShuffle, makeSeed, orderSalt, orderEpoch } from '../lib/shuffle'
import { todayStr, weekStartStr } from '../lib/storage'
import { currentSalt, currentShuffleMode, fetchShuffleSalt } from '../lib/api'
import type { AnswerRecord, AudioItem } from '../types'

/**
 * 期末模考：整卷连续作答 + 全程计时，模拟真实考试。
 * 与「每日听写」的区别：
 *   - 不逐题给反馈，全部答完才出成绩
 *   - 有倒计时/正计时
 *   - 可整卷顺序刷，也可自由跳题
 */
export default function Exam() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, submitSession, profile } = useStore()
  const track = getTrack(id)

  const [items, setItems] = useState<AudioItem[]>(() => track ? tuplesToItems(track.items) : [])
  const [inputs, setInputs] = useState<Record<number, string>>({})
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  const commitRef = useRef(false)

  // 加载带音频文件名的条目
  useEffect(() => {
    if (!track) return
    let cancel = false
    fetchShuffleSalt().finally(() => {
      if (cancel) return
      loadAudioIndex().then(idxMap => {
        if (cancel) return
        const fromAudio = idxMap[track.id]
        let list: AudioItem[] = tuplesToItems(track.items)
        if (fromAudio && fromAudio.length) {
          list = fromAudio.map((a, i) => ({
            no: a.no ?? i + 1,
            word: a.word,
            cn: a.cn || track.items[i]?.[2] || '',
            file: a.file,
          }))
        }
        // 随机出题（防规律），时间成分+盐与听写/打印卷一致
        if (progress.settings.shuffle && list.length > 1) {
          const mode = currentShuffleMode()
          const epoch = orderEpoch(mode, todayStr(), weekStartStr())
          const salt = orderSalt(mode, weekStartStr(), currentSalt())
          list = seededShuffle(list, makeSeed(epoch, profile.id, track.id, salt))
        }
        setItems(list)
      })
    })
    return () => { cancel = true }
  }, [track, profile.id, progress.settings.shuffle])

  const cur = items[idx]

  // 计时
  useEffect(() => {
    if (done) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [done])

  // 自动播报当前题
  useEffect(() => {
    if (!cur || done) return
    let cancel = false
    ;(async () => {
      setPlaying(true)
      await new Promise(r => setTimeout(r, 200))
      if (cancel) return
      await playWord(cur, progress.settings.rate)
      if (!cancel) setPlaying(false)
    })()
    return () => { cancel = true; stopAll() }
  }, [idx, cur, done])

  const play = async () => {
    if (!cur) return
    setPlaying(true)
    await playWord(cur, progress.settings.rate)
    setPlaying(false)
  }

  const submitAll = () => {
    if (!track || commitRef.current) return
    commitRef.current = true
    const recs: AnswerRecord[] = items.map(it => ({
      no: it.no, word: it.word, cn: it.cn,
      input: inputs[it.no] || '',
      correct: judge(inputs[it.no] || '', it.word),
    }))
    submitSession(track, recs, elapsed)
    setDone(true)
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (!track) return <Shell title="未找到" back><div className="empty"><div className="i">🤔</div><div>没有这个任务</div></div></Shell>

  const answered = Object.values(inputs).filter(x => x.trim()).length

  // ── 成绩单 ──
  if (done) {
    const recs: AnswerRecord[] = items.map(it => ({
      no: it.no, word: it.word, cn: it.cn,
      input: inputs[it.no] || '',
      correct: judge(inputs[it.no] || '', it.word),
    }))
    const right = recs.filter(r => r.correct).length
    const score = items.length ? Math.round((right / items.length) * 100) : 0
    const wrongs = recs.filter(r => !r.correct)
    return (
      <Shell title="模考成绩单" back noNav>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{score === 100 ? '🏆' : score >= 90 ? '🎉' : score >= 70 ? '👍' : '📖'}</div>
            <div className="num">{score}<span style={{ fontSize: 26 }}>%</span></div>
            <div className="lab">{track.label}</div>
            <div className="lab" style={{ marginTop: 6 }}>
              用时 {fmt(elapsed)} · 答对 {right}/{items.length}
            </div>
          </div>
        </div>

        {wrongs.length > 0 && (
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>❌ 错词 {wrongs.length} 个（已进错词本）</div>
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
        )}

        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>全部答题情况</div>
          <div className="reviewlist">
            {recs.map(a => (
              <div key={a.no} className="rv">
                <span className="mk">{a.correct ? '✓' : '✗'}</span>
                <span className="w" style={{ fontSize: 15 }}>{a.word}</span>
                {!a.correct && a.input && <span className="mine">{a.input}</span>}
                <span className="sub small" style={{ marginLeft: 'auto' }}>{a.cn}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn ghost" onClick={() => location.reload()}>🔁 再考一次</button>
          <button className="btn" onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  // ── 答题中 ──
  return (
    <Shell
      title={track.label || '模考'}
      back
      sub={`${answered}/${items.length} 已答`}
      noNav
      right={<span className="pill p-purple mono">{fmt(elapsed)}</span>}
    >
      <div className="card pad" style={{ padding: 12, marginBottom: 10 }}>
        <div className="between small">
          <span>📝 模考模式：全部答完后统一判分</span>
          <button className="btn gold sm" onClick={submitAll} disabled={answered === 0}>交卷</button>
        </div>
      </div>

      <div className="playbox">
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>
          第 <b style={{ color: 'var(--blue)', fontSize: 16 }}>{cur.no}</b> 题
        </div>
        <button className={'bigplay' + (playing ? ' playing' : '')} onClick={play}>
          {playing ? '♪' : '🔊'}
        </button>
        <div className="cn">{cur.cn}</div>
        <div className="hint">看不出来？先听几遍，实在不行标记跳过</div>
      </div>

      <div className="answerrow">
        <input
          autoFocus
          value={inputs[cur.no] || ''}
          onChange={e => setInputs(s => ({ ...s, [cur.no]: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (idx + 1 < items.length) setIdx(i => i + 1)
              else submitAll()
            }
          }}
          placeholder="写英文…"
          spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
        />
        <button
          className="sub btn"
          onClick={() => idx + 1 < items.length ? setIdx(i => i + 1) : submitAll()}
        >下一题</button>
      </div>

      <div className="controls">
        <button className="btn ghost" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>‹ 上一题</button>
        <button className="btn ghost" onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))} disabled={idx >= items.length - 1}>下一题 ›</button>
      </div>

      {/* 题号跳转 */}
      <div className="card pad mt">
        <div className="sub small" style={{ marginBottom: 8 }}>题号导航（点一下跳过去）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((it, i) => {
            const on = i === idx
            const has = (inputs[it.no] || '').trim()
            return (
              <button
                key={it.no}
                onClick={() => setIdx(i)}
                style={{
                  width: 34, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 700,
                  border: '1px solid ' + (on ? 'var(--blue)' : 'var(--line)'),
                  background: on ? 'var(--blue)' : has ? 'var(--ok-soft)' : '#fff',
                  color: on ? '#fff' : has ? 'var(--ok)' : 'var(--sub)',
                }}
              >{it.no}</button>
            )
          })}
        </div>
      </div>
    </Shell>
  )
}
