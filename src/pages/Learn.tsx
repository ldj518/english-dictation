import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import AudioGate from '../components/AudioGate'
import { useStore } from '../lib/store'
import { flowStepOf } from '../lib/flow'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems, wordFileMap } from '../lib/data'
import { playWord, pauseAll, prefetchAhead, resolveRate } from '../lib/player'
import { splitSyllables } from '../lib/syllables'
import type { AudioItem, Track } from '../types'

/**
 * 学习环节（v2.7，可跳过）：听写前把本次要考的词快速过一遍。
 *
 * 设计原则：
 * - 速览卡片流，不做小测验——预习一旦像考试，孩子就会烦
 * - 错词本里的词置顶 + 标红 + 播两遍（哪里弱先补哪里）
 * - 顶部「跳过学习」永远好用，尊重「他已经会了」的事实
 * - 防泄题不受影响：学习本来就是明示单词的环节
 */
export default function Learn() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, markLearned, advanceFlow } = useStore()

  const [track, setTrack] = useState<Track | undefined>(() => getTrack(id))
  const [items, setItems] = useState<AudioItem[]>([])
  const [started, setStarted] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const startedAt = useRef(Date.now())
  const playToken = useRef(0)
  const recorded = useRef(false)   // 学习时长只记一次

  // 动态任务（plan/mix）异步合成
  useEffect(() => {
    if (getTrack(id)) return
    let cancel = false
    void getTrackAny(id).then(t => { if (!cancel && t) setTrack(t) })
    return () => { cancel = true }
  }, [id])

  // 词单加载：不洗牌（学习按卷面顺序过，听写时才打乱）
  useEffect(() => {
    if (!track) return
    let cancel = false
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
      // 错词置顶（按错得多在前），其余保持原顺序
      const wrongOf = (w: string) => progress.wrong[w]?.count || 0
      list = [...list].sort((x, y) => wrongOf(y.word) - wrongOf(x.word))
      setItems(list)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track])

  const rate = resolveRate(false, progress.settings.rate)
  const cur = items[idx]
  const isLast = idx >= items.length - 1

  // 进卡自动播：错过的词播两遍
  useEffect(() => {
    if (!started || !cur) return
    let cancelled = false
    const token = ++playToken.current
    ;(async () => {
      setPlaying(true)
      prefetchAhead(items, idx, 3)
      await new Promise(r => setTimeout(r, 250))
      if (cancelled || token !== playToken.current) return
      await playWord(cur, rate)
      if (cancelled || token !== playToken.current) return
      if (progress.wrong[cur.word]) {
        await new Promise(r => setTimeout(r, 700))
        if (cancelled || token !== playToken.current) return
        await playWord(cur, rate)
      }
      if (!cancelled) setPlaying(false)
    })()
    return () => { cancelled = true; pauseAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cur, started])

  /** 离开时记一次学习账（时长折算分钟，写进 progress.learned） */
  const recordOnce = () => {
    if (recorded.current) return
    recorded.current = true
    markLearned(id, Math.round((Date.now() - startedAt.current) / 1000))
  }

  // 闯关态（v3.5）：今天的第 1 关还没过、且做的是 plan 任务 → 完成后推进并直进第 2 关。
  const inFlow = id === 'plan' && flowStepOf(progress) === 1
  // 重学态（v3.5.1）：dayXX 是考场选来重学的一天 → 完成后走同一条五关链（不记账）
  const isRelearn = /^day\d+$/.test(id)

  /** 主按钮：链内前进。plan 记账进第 2 关；dayXX 直接进第 2 关；其他任务直达听写（原逻辑） */
  const goNextFlow = () => {
    recordOnce()
    if (inFlow) {
      advanceFlow(1)
      nav('/translate/plan')
      return
    }
    if (isRelearn) {
      nav('/translate/' + id)
      return
    }
    try { sessionStorage.setItem('skip-prep-' + id, '1') } catch { /* ignore */ }
    nav('/d/' + id)
  }

  /** 副按钮：跳过学习，直接听写这一天 */
  const goDictation = () => {
    recordOnce()
    try { sessionStorage.setItem('skip-prep-' + id, '1') } catch { /* ignore */ }
    nav('/d/' + id)
  }

  const next = () => {
    if (!isLast) setIdx(i => i + 1)
  }

  // 键盘：空格 / 回车 / 右方向键 = 下一个
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started || !items.length) return
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, items.length, idx])

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

  // 音频开始门（与听写页同理：微信拦截无手势自动播放）
  if (!started) {
    return (
      <Shell title={`预习 · ${track.label || track.id}`} back noNav>
        <AudioGate
          onStart={() => { setStarted(true); startedAt.current = Date.now() }}
          title="先花两分钟过一遍词"
          tip="每张卡片：看单词、听发音、看意思。觉得都会了，随时可以跳过去听写。"
        />
      </Shell>
    )
  }

  if (!cur) {
    return (
      <Shell title="预习" back>
        <div className="empty"><div className="i">🤔</div><div>这个词单暂时没有内容</div></div>
      </Shell>
    )
  }

  const wrongCount = progress.wrong[cur.word]?.count || 0

  return (
    <Shell title={`预习 · ${track.label || track.id}`} back sub={`已学 ${idx + 1}/${items.length}`} noNav>
      <div className="qbar">
        <div className="progressbar"><i style={{ width: ((idx + 1) / items.length) * 100 + '%' }} /></div>
      </div>

      <div className="playbox" style={{ padding: '26px 18px' }}>
        {wrongCount > 0 && (
          <div style={{
            fontSize: 12, color: '#a32d2d', background: '#fcebeb',
            borderRadius: 999, padding: '4px 12px', display: 'inline-block', marginBottom: 10,
          }}>⚠️ 这个词你错过 {wrongCount} 次，多听两遍</div>
        )}
        <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.2, wordBreak: 'break-word' }}>{cur.word}</div>
        {/* 音节色块（v2.8）：只在预习出现，帮孩子把长词切小块记；听写环节绝不显示 */}
        {(() => {
          const syls = splitSyllables(cur.word)
          if (syls.length < 2) return null
          return (
            <div style={{ marginTop: 8, display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
              {syls.map((syl, i) => (
                <span key={i} style={{
                  fontSize: 18, fontWeight: 800, padding: '2px 9px', borderRadius: 8, letterSpacing: 0.5,
                  background: i % 2 ? '#eef3ff' : '#fff3e0',
                  color: i % 2 ? '#2f5fd0' : '#b06a00',
                }}>{syl}</span>
              ))}
            </div>
          )
        })()}
        <button
          className={'bigplay' + (playing ? ' playing' : '')}
          style={{ margin: '16px auto 6px' }}
          onClick={() => { playToken.current++; pauseAll(); void playWord(cur, rate).then(() => setPlaying(false)) }}
          aria-label="重播"
        >{playing ? '♪' : '🔊'}</button>
        <div style={{ fontSize: 12, color: 'var(--sub)' }}>点 🔊 再听一次</div>
        <div className="cn" style={{ marginTop: 16 }}>{cur.cn}</div>
      </div>

      <div className="controls" style={{ flexDirection: 'column', gap: 10 }}>
        {isLast ? (
          <button className="btn" style={{ background: 'var(--blue)', minHeight: 50, width: '100%' }} onClick={goNextFlow}>
            {inFlow ? '✓ 第 1 关完成，进入下一关 →'
              : isRelearn ? '✓ 这天的词过完了，进入下一关 →'
                : '🎧 都过完了，开始听写'}
          </button>
        ) : (
          <button className="btn" style={{ background: 'var(--blue)', minHeight: 50, width: '100%' }} onClick={next}>
            认识了，下一个 →
          </button>
        )}
        <button className="btn ghost" style={{ width: '100%' }} onClick={inFlow ? goNextFlow : goDictation}>
          {inFlow ? '⏭ 跳过本关，直接下一关'
            : isRelearn ? '⏭ 跳过学习，直接听写这天'
              : '⏭ 跳过剩下的，直接听写'}
        </button>
      </div>

      <div className="sub small center" style={{ marginTop: 10 }}>
        空格键也能翻下一张 · 学过一遍的词，听写时心里更有底
      </div>
    </Shell>
  )
}
