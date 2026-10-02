import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import PinGate from '../components/PinGate'
import LetterKeyboard from '../components/LetterKeyboard'
import FlowNextBar from '../components/FlowNextBar'
import { isFlowTaskId } from '../lib/flow'
import { useStore, judge } from '../lib/store'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems, wordFileMap, playWordText } from '../lib/data'
import { seededShuffle, makeSeed, newSalt, orderSalt, orderEpoch } from '../lib/shuffle'
import { currentSalt, currentShuffleMode, fetchShuffleSalt } from '../lib/api'
import { todayStr, weekStartStr } from '../lib/storage'
import type { AnswerRecord, AudioItem, Track } from '../types'

/**
 * 首字母填空（v3.0）：/spell/:id
 *
 * 贴初中考试题型（词汇运用：根据汉语提示和首字母写出单词）：
 * - 屏幕给「中文释义 + 首字母 + 词长」孩子拼出完整单词
 * - 不自动播音频——听写页考「听」，这里考「拼」；确认后播一遍做音形连接
 * - 防泄题与听写同规：提交前绝不出现完整词形；错词明细锁家长解锁码
 * - 记账 mode='spell'，skipBest：不占任务卡上显示的听写最好成绩
 * - 同种子洗牌：同一天同一人，与听写/打印卷/纸听顺序一致
 */
export default function Spell() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, recordAnswer, submitSession, profile, advanceFlow } = useStore()
  const kb = progress.settings.kbBuiltIn !== false

  const [track, setTrack] = useState<Track | undefined>(() => getTrack(id))
  const [items, setItems] = useState<AudioItem[]>([])
  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'ask' | 'done'>('ask')
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [result, setResult] = useState<{ score: number; right: number; total: number; seconds: number; attemptNo: number } | null>(null)
  const [salt, setSalt] = useState('')
  const startedAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)

  // 动态任务（plan/mix）异步合成
  useEffect(() => {
    if (getTrack(id)) return
    let cancel = false
    void getTrackAny(id).then(t => { if (!cancel && t) setTrack(t) })
    return () => { cancel = true }
  }, [id])

  // 词单加载：与听写/打印卷/纸听完全同种子
  useEffect(() => {
    if (!track) return
    let cancel = false
    fetchShuffleSalt().finally(() => {
      if (cancel) return
      Promise.all([loadAudioIndex(), wordFileMap()]).then(([idxMap, fmap]) => {
        if (cancel) return
        const fromAudio = idxMap[track.id]
        let list: AudioItem[]
        if (fromAudio && fromAudio.length) {
          list = fromAudio.map((a, i) => ({
            no: a.no ?? i + 1, word: a.word, cn: a.cn || track.items[i]?.[2] || '', file: a.file,
          }))
        } else {
          list = tuplesToItems(track.items).map(it => ({ ...it, file: fmap.get(it.word) || null }))
        }
        if (progress.settings.shuffle && list.length > 1) {
          const mode = currentShuffleMode()
          const epoch = orderEpoch(mode, todayStr(), weekStartStr())
          const baseSalt = orderSalt(mode, weekStartStr(), currentSalt())
          const combined = salt ? (baseSalt ? `${baseSalt}|${salt}` : salt) : baseSalt
          list = seededShuffle(list, makeSeed(epoch, profile.id, track.id, combined))
        }
        // 错词加练（结果页跳回来时带的词单）
        try {
          const rw = sessionStorage.getItem('retrain-words')
          if (rw) {
            sessionStorage.removeItem('retrain-words')
            const set = new Set(JSON.parse(rw) as string[])
            const filtered = list.filter(i => set.has(i.word))
            if (filtered.length) list = filtered
          }
        } catch { /* ignore */ }
        setItems(list)
        startedAt.current = Date.now()
      })
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, profile.id, salt])

  const cur = items[idx]

  // 自动聚焦
  useEffect(() => {
    if (phase === 'ask') setTimeout(() => inputRef.current?.focus(), 100)
  }, [idx, phase])

  const submit = () => {
    if (!cur) return
    const ok = judge(input, cur.word)
    const rec: AnswerRecord = { no: cur.no, word: cur.word, cn: cur.cn, input, correct: ok }
    recordAnswer(cur.word, cur.cn, input, ok)
    setAnswers(a => [...a, rec])
    setPhase('done')
    // 音形连接：判定完立刻读一遍（在手势链里，不受自动播放限制）
    void playWordText(cur.word, 0.9)
  }

  const next = () => {
    if (idx + 1 >= items.length) { finish(); return }
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
    const today = todayStr()
    const attemptNo = progress.history.filter(
      h => h.trackId === track.id && todayStr(new Date(h.at)) === today
    ).length + 1
    submitSession(track, recs, sec, 'spell', { skipBest: true })
    // 闯关第 4 关（v3.5）：plan 任务做完即记账（幂等）
    if (track.id === 'plan') advanceFlow(4)
    setResult({ score, right, total, seconds: sec, attemptNo })
  }

  /** 错词加练：只重练本次拼错的词 */
  const onRetrain = () => {
    if (!track) return
    const wrongWords = [...new Set(answers.filter(a => !a.correct).map(a => a.word))]
    if (!wrongWords.length) return
    try { sessionStorage.setItem('retrain-words', JSON.stringify(wrongWords)) } catch { /* ignore */ }
    setResult(null); setIdx(0); setInput(''); setAnswers([]); setPhase('ask')
    setSalt(newSalt())
    window.scrollTo({ top: 0 })
  }

  if (!track) {
    const loadingDyn = id === 'plan' || id === 'mix'
    return (
      <Shell title={loadingDyn ? '准备词单' : '未找到'} back>
        <div className="empty">
          <div className="i">{loadingDyn ? '⏳' : '🤔'}</div>
          <div>{loadingDyn ? '正在准备今天的词单…' : '没有这个任务'}</div>
        </div>
      </Shell>
    )
  }

  if (result) {
    return <SpellResult track={track} result={result} answers={answers} onHome={() => nav('/')} onRetrain={onRetrain} />
  }

  if (!cur) {
    return (
      <Shell title={`首字母填空 · ${track.label || track.id}`} back>
        <div className="empty"><div className="i">⏳</div><div>词单准备中…</div></div>
      </Shell>
    )
  }

  const lastRec = answers[answers.length - 1]
  const pct = Math.round(((idx + (phase === 'done' ? 1 : 0)) / items.length) * 100)
  // 首字母 + 词长提示（考试固有信息，不算泄题）
  const hint = cur.word[0] + ' ' + cur.word.slice(1).split('').map(() => '_').join(' ')

  return (
    <Shell title={`首字母填空 · ${track.label || track.id}`} back sub={`${idx + 1}/${items.length}`} noNav>
      <div className="qbar">
        <div className="qhead">
          <span>进度 <b>{idx + 1}</b> / {items.length}</span>
          <span>🎯 得分 {answers.filter(a => a.correct).length * 10}</span>
        </div>
        <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
      </div>

      <div className="playbox" style={{ padding: '26px 18px' }}>
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>根据意思和首字母，写出这个单词</div>
        <div className="cn" style={{ fontSize: 22, fontWeight: 700, margin: '14px 0 18px' }}>{cur.cn}</div>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: cur.word.length > 10 ? 24 : 30, fontWeight: 800, letterSpacing: 3,
          color: 'var(--ink)', wordBreak: 'break-all', lineHeight: 1.5,
        }}>{hint}</div>
      </div>

      <div className="answerrow">
        <input
          ref={inputRef}
          className={phase === 'done' ? (lastRec?.correct ? 'ok' : 'bad') : ''}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              phase === 'ask' ? submit() : next()
            }
          }}
          placeholder="在这里写英文…"
          inputMode={kb ? 'none' : 'text'}
          spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          disabled={phase === 'done'}
        />
        {phase === 'ask'
          ? <button className="sub btn" onClick={submit} disabled={!input.trim()}>确认</button>
          : <button className="sub btn ok" onClick={next}>下一题</button>}
      </div>

      {kb && (
        <LetterKeyboard
          disabled={phase === 'done'}
          onKey={c => setInput(v => v + c)}
          onBackspace={() => setInput(v => v.slice(0, -1))}
          onSubmit={() => (phase === 'ask' ? submit() : next())}
        />
      )}

      {phase === 'done' && lastRec && (
        <div className={'verdict ' + (lastRec.correct ? 'ok' : 'bad')}>
          {lastRec.correct ? (
            <>✓ 拼对了 · 发音再听一遍</>
          ) : (
            <>
              正确答案<span className="ans">{cur.word}</span>
              {lastRec.input && <span style={{ fontSize: 13, fontWeight: 400 }}>你写的是「{lastRec.input}」</span>}
            </>
          )}
        </div>
      )}

      <div className="center mt">
        <button className="btn ghost sm" onClick={finish} disabled={!answers.length && idx === 0}>结束并交卷</button>
      </div>
    </Shell>
  )
}

function SpellResult({ track, result, answers, onHome, onRetrain }: {
  track: Track
  result: { score: number; right: number; total: number; seconds: number; attemptNo: number }
  answers: AnswerRecord[]
  onHome: () => void
  onRetrain: () => void
}) {
  const wrongs = answers.filter(a => !a.correct)
  const emoji = result.score === 100 ? '🏆' : result.score >= 90 ? '🎉' : result.score >= 70 ? '👍' : result.score >= 50 ? '💪' : '📖'
  const word = result.score === 100 ? '完美通关！' : result.score >= 90 ? '太棒了！' : result.score >= 70 ? '不错，继续加油' : result.score >= 50 ? '还差一点' : '多练几遍就熟了'
  const sec = result.seconds
  const fmt = sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`

  return (
    <Shell title="首字母填空结果" back noNav>
      <div className="card">
        <div className="scorebig">
          <div className="emoji">{emoji}</div>
          <div className="num">{result.score}<span style={{ fontSize: 26 }}>%</span></div>
          <div className="lab">{word}</div>
          <div className="lab" style={{ marginTop: 8 }}>
            拼对 <b style={{ color: 'var(--ok)' }}>{result.right}</b> / {result.total} 词
            {' · '}拼错 <b style={{ color: 'var(--bad)' }}>{result.total - result.right}</b> 词
            {' · '}用时 {fmt}
          </div>
          <div className="lab" style={{
            marginTop: 8, fontSize: 13, fontWeight: 600,
            color: result.attemptNo > 1 ? '#b45309' : 'var(--sub)',
          }}>
            {result.attemptNo > 1
              ? `⚠️ 这是今天第 ${result.attemptNo} 次做这个任务`
              : '今天第 1 次做这个任务'}
          </div>
          <div className="lab sub small" style={{ marginTop: 6 }}>
            拼写成绩单独记，不影响听写的最好成绩
          </div>
        </div>
      </div>

      {/* 闯关第 4 关（v3.5.1）：完成后引导去第 5 关；plan 记账、dayXX 重学链；其他任务不显示 */}
      <FlowNextBar doneStep={4} taskId={isFlowTaskId(track.id) ? track.id : undefined} />

      {wrongs.length > 0 && (
        <button className="btn gold" style={{ width: '100%' }} onClick={onRetrain}>
          ⚡ 错词加练（{wrongs.length} 词）
        </button>
      )}

      {/* 防泄题：错词明细含完整词形，锁家长解锁码后面 */}
      <PinGate title="错词明细需家长解锁">
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>全部题目</div>
          <div className="reviewlist">
            {answers.map(a => (
              <div key={a.no} className="rv">
                <span className="mk" style={{ color: a.correct ? 'var(--ok)' : 'var(--bad)' }}>{a.correct ? '✓' : '✗'}</span>
                <span className="w">{a.word}</span>
                {!a.correct && a.input && <span className="mine">{a.input}</span>}
                <span className="sub small">{a.cn}</span>
              </div>
            ))}
          </div>
        </div>
      </PinGate>

      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost" onClick={() => location.reload()}>🔁 再练一遍</button>
        <button className="btn" onClick={onHome}>回首页</button>
      </div>
    </Shell>
  )
}
