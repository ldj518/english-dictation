import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems, wordFileMap } from '../lib/data'
import { playWord, pauseAll, resolveRate } from '../lib/player'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import { todayStr } from '../lib/storage'
import { createShare } from '../lib/api'
import { buildCnOptions } from '../lib/translate'
import { WORD_MAP } from '../lib/data'
import AudioGate from '../components/AudioGate'
import LetterKeyboard from '../components/LetterKeyboard'
import FlowNextBar from '../components/FlowNextBar'
import { isFlowTaskId, skipGate } from '../lib/flow'
import type { AnswerRecord, AudioItem, Track } from '../types'

/**
 * 翻译关：听写完后对同一批词做双向巩固。
 *
 * 两个方向（单屏单语，沿用防泄题硬规则）：
 * - 英译汉（e2c）：屏幕显示英文 + 读音 → 四个中文选项里选对的意思
 *   干扰项取自同一张卷，3 个都不重复
 * - 汉译英（c2e）：屏幕显示中文 + 读音 → 键盘拼写英文
 *   英文答案在作答前绝不上屏
 *
 * 成绩单独记一笔（trackId 加 -t 后缀），不污染原听写任务的最佳成绩。
 */
export default function Translate() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { recordAnswer, submitSession, profile, progress, advanceFlow } = useStore()
  /** 内置 26 键键盘（默认开）：杜绝输入法联想把整词弹出来 */
  const kb = progress.settings.kbBuiltIn !== false
  // 静态任务同步可得；plan/mix 异步合成
  const [track, setTrack] = useState<Track | undefined>(() => getTrack(id))
  useEffect(() => {
    let cancel = false
    void getTrackAny(id).then(t => { if (!cancel && t) setTrack(t) })
    return () => { cancel = true }
  }, [id])

  const [dir, setDir] = useState<'e2c' | 'c2e'>('e2c')
  const [items, setItems] = useState<AudioItem[]>([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'ask' | 'done'>('ask')
  const [picked, setPicked] = useState('')
  const [input, setInput] = useState('')
  const [last, setLast] = useState<AnswerRecord | null>(null)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [result, setResult] = useState<{ score: number; right: number; total: number; seconds: number } | null>(null)
  const [shareHint, setShareHint] = useState('')
  const startedAt = useRef(Date.now())
  const playToken = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // 音频开始门：微信拦截无手势自动播放，第一题必须点「开始」后才能读
  const [started, setStarted] = useState(false)
  // v3.3：会话级随机种子——每次进入翻译关题目与选项顺序全变（防背位置），
  // 单次会话内稳定（切方向/回上一题不乱跳）。翻译关无纸质对应物，不走全局盐体系
  const [sessionSeed] = useState(() => Math.random().toString(36).slice(2, 10))
  // 全册词库兜底池：小卷干扰项不足 5 个时从这补
  const extraPool = useMemo(
    () => Object.values(WORD_MAP).map(w => ({ word: w.word, cn: w.cn })),
    [],
  )
  const start = () => {
    setStarted(true)
    startedAt.current = Date.now()
  }

  // 加载词单（与听写卷同源词库），按会话种子洗牌
  useEffect(() => {
    if (!track) return
    let cancel = false
    Promise.all([loadAudioIndex(), wordFileMap()]).then(([idxMap, fmap]) => {
      if (cancel) return
      const fromAudio = idxMap[track.id]
      let list: AudioItem[]
      if (fromAudio && fromAudio.length) {
        list = fromAudio.map((a, i) => ({
          no: a.no ?? i + 1,
          word: a.word,
          cn: a.cn || track.items[i]?.[2] || '',
          file: a.file,
        }))
      } else {
        // 动态任务（每日计划/智能混合卷）：任务自带词单 + 全词库音频映射
        list = tuplesToItems(track.items).map(it => ({
          ...it, file: fmap.get(it.word) || null,
        }))
      }
      if (list.length > 1) {
        list = seededShuffle(list, makeSeed(sessionSeed, profile.id, track.id + '-t', dir))
      }
      setItems(list)
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, profile.id, dir])

  const cur = items[idx]

  // 进题自动播一遍读音（两个方向都要听音；等开始门解锁后）
  useEffect(() => {
    if (!started || !cur || phase !== 'ask') return
    let cancelled = false
    const token = ++playToken.current
    ;(async () => {
      await new Promise(r => setTimeout(r, 200))
      if (cancelled || token !== playToken.current) return
      await playWord(cur, resolveRate(false, progress.settings.rate))
    })()
    return () => { cancelled = true; pauseAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cur, phase, started])

  // c2e 自动聚焦
  useEffect(() => {
    if (dir === 'c2e' && phase === 'ask') setTimeout(() => inputRef.current?.focus(), 100)
  }, [idx, phase, dir])

  const opts = useMemo(
    () => (dir === 'e2c' && cur && track
      ? buildCnOptions(items, cur.word, `${sessionSeed}|${profile.id}|${track.id}-t|${dir}|${cur.no}`, extraPool)
      : []),
    [dir, cur, items, profile.id, track, sessionSeed, extraPool]
  )

  if (!track) {
    const loadingDyn = id === 'plan' || id === 'mix'
    return (
      <Shell title={loadingDyn ? '准备词单' : '未找到'} back>
        <div className="empty">
          <div className="i">{loadingDyn ? '⏳' : id === 'wcustom' ? '📖' : '🤔'}</div>
          <div>{loadingDyn ? '正在准备今天的词单…' : id === 'wcustom' ? '还没有选词' : '没有这个任务'}</div>
          {id === 'wcustom' && (
            <button className="btn" style={{ marginTop: 14 }} onClick={() => nav('/review')}>回错词本选词</button>
          )}
        </div>
      </Shell>
    )
  }

  const replay = () => { if (cur) { playToken.current++; pauseAll(); playWord(cur, resolveRate(false, progress.settings.rate)) } }

  const pick = (cn: string) => {
    if (phase !== 'ask' || !cur) return
    const ok = cn === cur.cn
    const rec: AnswerRecord = { no: cur.no, word: cur.word, cn: cur.cn, input: '', correct: ok }
    recordAnswer(cur.word, cur.cn, '', ok)
    setPicked(cn)
    setLast(rec)
    setAnswers(a => [...a, rec])
    setPhase('done')
  }

  const submitTyping = () => {
    if (phase !== 'ask' || !cur) return
    const ok = judge(input, cur.word)
    const rec: AnswerRecord = { no: cur.no, word: cur.word, cn: cur.cn, input, correct: ok }
    recordAnswer(cur.word, cur.cn, input, ok)
    setLast(rec)
    setAnswers(a => [...a, rec])
    setPhase('done')
  }

  const next = () => {
    if (idx + 1 >= items.length) { finish(); return }
    setIdx(i => i + 1)
    setPicked(''); setInput(''); setPhase('ask')
  }

  const finish = () => {
    const recs = answers
    const total = recs.length
    const right = recs.filter(r => r.correct).length
    const score = total ? Math.round((right / total) * 100) : 0
    const sec = Math.round((Date.now() - startedAt.current) / 1000)
    // 独立记一笔：trackId 加 -t 后缀，不覆盖原听写任务成绩
    const t: Track = { ...track, id: track.id + '-t', label: (track.label || track.id) + ' · 翻译关' }
    submitSession(t, recs, sec, 'translate')
    // 闯关第 2 关（v3.5）：plan 任务做完即记账（幂等，乱序不动账）
    if (track.id === 'plan') advanceFlow(2)
    setResult({ score, right, total, seconds: sec })
  }

  const switchDir = (d: 'e2c' | 'c2e') => {
    if (d === dir) return
    setDir(d)
    setIdx(0); setPicked(''); setInput(''); setAnswers([]); setPhase('ask')
    startedAt.current = Date.now()
  }

  /* ── 结果页 ── */
  if (result) {
    const wrongs = answers.filter(a => !a.correct)
    const makeShare = async () => {
      setShareHint('生成中…')
      const url = await createShare({
        v: 1, studentName: profile.name, emoji: profile.emoji,
        title: `翻译关 · ${track.label || track.id}`,
        date: todayStr(), score: result.score, sessions: 1,
        total: result.total, right: result.right,
        wrongs: wrongs.map(w => ({ word: w.word, cn: w.cn })),
        photoKeys: [],
      })
      if (!url) { setShareHint('生成失败：网络不通'); return }
      try { await navigator.clipboard.writeText(url); setShareHint('链接已复制，去微信粘贴发送即可') }
      catch { setShareHint(url) }
    }
    return (
      <Shell title="翻译关结果" back noNav>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{result.score === 100 ? '🏆' : result.score >= 80 ? '🎉' : '💪'}</div>
            <div className="num">{result.score}<span style={{ fontSize: 26 }}>%</span></div>
            <div className="lab">
              答对 <b style={{ color: 'var(--ok)' }}>{result.right}</b> / {result.total} 题
              {' · '}用时 {Math.floor(result.seconds / 60)}分{result.seconds % 60}秒
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn" style={{ background: '#07c160' }} onClick={makeShare}>🔗 分享链接（发微信）</button>
          <button className="btn ghost" onClick={() => location.reload()}>🔁 再练一遍</button>
        </div>
        {shareHint && <div className="tip" style={{ background: '#e7f5ee', color: '#0b7285', wordBreak: 'break-all' }}>{shareHint}</div>}

        {/* 闯关第 2 关（v3.5.1）：plan 走今日主线记账；dayXX 重学链不记账；其他任务不显示 */}
        <FlowNextBar doneStep={2} taskId={isFlowTaskId(track.id) ? track.id : undefined} />

        {wrongs.length > 0 ? (
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 4 }}>❌ 错词 {wrongs.length} 个（已进错词本）</div>
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
            <div style={{ fontWeight: 800, color: 'var(--ok)' }}>✨ 全对！这批词过关了</div>
          </div>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button className="btn ghost" onClick={() => nav(`/d/${track.id}`)}>回听写</button>
          <button className="btn" onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  if (!cur) return <Shell title="翻译关" back noNav><div className="empty sub">加载中…</div></Shell>

  // ── 音频开始门 ──
  if (!started) {
    return (
      <Shell title="翻译关" back noNav>
        <AudioGate
          onStart={start}
          title="准备好翻译关了吗？"
          tip="英译汉 + 汉译英双向过一遍，点按钮开始。"
        />
      </Shell>
    )
  }

  const pct = items.length ? Math.round(((idx + (phase === 'done' ? 1 : 0)) / items.length) * 100) : 0

  return (
    <Shell title="翻译关" back sub={`${idx + 1}/${items.length}`} noNav>
      <div className="qbar">
        <div className="qhead">
          <span>巩固 <b>{idx + 1}</b> / {items.length}</span>
          <span>🎯 {answers.filter(a => a.correct).length * 10} 分</span>
        </div>
        <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
        <div className="seg" style={{ marginTop: 10 }}>
          <button className={dir === 'e2c' ? 'on' : ''} onClick={() => switchDir('e2c')}>🔤 听英选中</button>
          <button className={dir === 'c2e' ? 'on' : ''} onClick={() => switchDir('c2e')}>⌨️ 看中拼英</button>
        </div>
      </div>

      {dir === 'e2c' ? (
        <div className="playbox">
          <div style={{ fontSize: 13, color: 'var(--sub)' }}>听读音，选对意思</div>
          <div className="wordBig">{cur.word}</div>
          <button className="bigplay" onClick={replay} aria-label="重播">🔊</button>
          <div className="optGrid">
            {opts.map(o => {
              const isPicked = picked === o.cn
              const reveal = phase === 'done'
              const cls = reveal
                ? (o.correct ? 'opt right' : isPicked ? 'opt wrong' : 'opt dim')
                : 'opt'
              return (
                <button key={o.cn} className={cls} onClick={() => pick(o.cn)} disabled={phase === 'done'}>
                  {o.cn}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="playbox">
          <div style={{ fontSize: 13, color: 'var(--sub)' }}>看中文 + 听读音，拼出英文</div>
          <div className="wordBig">{cur.cn}</div>
          <button className="bigplay" onClick={replay} aria-label="重播">🔊</button>
          <div className="answerrow">
            <input
              ref={inputRef}
              className={phase === 'done' ? (last?.correct ? 'ok' : 'bad') : ''}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); phase === 'ask' ? submitTyping() : next() }
              }}
              placeholder="在这里写英文…"
              inputMode={kb ? 'none' : 'text'}
              spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
              disabled={phase === 'done'}
            />
            {phase === 'ask'
              ? <button className="sub btn" onClick={submitTyping} disabled={!input.trim()}>确认</button>
              : <button className="sub btn ok" onClick={next}>下一题</button>}
          </div>
          {kb && (
            <LetterKeyboard
              disabled={phase === 'done'}
              onKey={c => setInput(v => v + c)}
              onBackspace={() => setInput(v => v.slice(0, -1))}
              onSubmit={() => (phase === 'ask' ? submitTyping() : next())}
            />
          )}
        </div>
      )}

      {phase === 'done' && last && (
        <div className={'verdict ' + (last.correct ? 'ok' : 'bad')}>
          {last.correct ? (
            <>✓ 答对了</>
          ) : dir === 'e2c' ? (
            <>正确意思<span className="ans">{cur.cn}</span></>
          ) : (
            <>正确答案<span className="ans">{cur.word}</span>{last.input && <span style={{ fontSize: 13, fontWeight: 400 }}>你写的是「{last.input}」</span>}</>
          )}
        </div>
      )}

      {/* 答完必须能走：done 状态下给显眼的下一题按钮（两个方向统一），最后一题变交卷 */}
      {phase === 'done' && (
        <div className="center mt">
          <button
            className="btn"
            style={{ background: 'var(--blue)', color: '#fff', minWidth: 220, fontSize: 17 }}
            onClick={next}
          >
            {idx + 1 >= items.length ? '交卷看成绩 ▶' : '下一题 ▶'}
          </button>
        </div>
      )}

      <div className="controls">
        <button className="btn ghost" onClick={() => { setIdx(i => Math.max(0, i - 1)); setPicked(''); setInput(''); setPhase('ask') }} disabled={idx === 0}>‹ 上一题</button>
        {phase === 'ask' && (
          <button className="btn ghost" onClick={() => { setPhase('done'); if (!answers.some(a => a.no === cur.no)) { const rec = { no: cur.no, word: cur.word, cn: cur.cn, input: '', correct: false }; recordAnswer(cur.word, cur.cn, '', false); setLast(rec); setAnswers(a => [...a, rec]) } }}>跳过</button>
        )}
        <button className="btn ghost" onClick={finish}>结束并交卷</button>
      </div>

      {/* 跳过整关（v3.6 错词五关）：重学链/错词链不记账，可以直接跳到下一关；
          plan 主线不能跳——账本要求按顺序完成，跳关会导致后面全记不上 */}
      {isFlowTaskId(track.id) && track.id !== 'plan' && skipGate('translate', track.id) && (
        <div className="center mt">
          <button className="btn ghost sm" onClick={() => nav(skipGate('translate', track.id)!)}>
            跳过这一关，直接去下一关 ›
          </button>
        </div>
      )}
    </Shell>
  )
}
