import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import AudioGate from '../components/AudioGate'
import { useStore } from '../lib/store'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems, wordFileMap } from '../lib/data'
import { playWord, pauseAll, prefetchAhead, resolveRate } from '../lib/player'
import { seededShuffle, makeSeed, orderSalt, orderEpoch } from '../lib/shuffle'
import { currentShuffleMode, currentSalt, fetchShuffleSalt } from '../lib/api'
import { todayStr, weekStartStr } from '../lib/storage'
import type { AudioItem, Track } from '../types'

/**
 * 纯纸听模式（v2.9）：/listen/:id
 *
 * 场景：孩子想写在纸上，不想对着屏幕打字（线上听写=纸上写一遍+屏幕再打一遍，双重劳动）。
 * 设计：
 * - 屏幕只负责放音频 + 显示「第 N 个 / 共 M 个」，零词形零中文——防泄题完全体，
 *   手机放旁边只当「播放器」，孩子全程面对纸
 * - 「第 N 个」用的是播放顺序（洗牌后的位置），与当天打印卷的重新编号 1..N 完全一致
 *   （同种子洗牌）——听写本第 N 行 = 打印卷第 N 题，三条线不再错位
 * - 每词播完设置的遍数就停，孩子写完自己点「下一个」，节奏归孩子
 * - 本页不记分：成绩由纸质批改页（家长解锁码后勾选）产生，避免双份账
 */
export default function Listen() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { profile, progress } = useStore()

  const [track, setTrack] = useState<Track | undefined>(() => getTrack(id))
  const [items, setItems] = useState<AudioItem[]>([])
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [slowMode, setSlowMode] = useState(false)
  const playToken = useRef(0)

  // 动态任务（plan/mix）异步合成
  useEffect(() => {
    if (getTrack(id)) return
    let cancel = false
    void getTrackAny(id).then(t => { if (!cancel && t) setTrack(t) })
    return () => { cancel = true }
  }, [id])

  // 词单加载：与听写页/打印卷完全同种子（同一天同一人 → 三种形式顺序一致）
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
          list = seededShuffle(list, makeSeed(epoch, profile.id, track.id, baseSalt))
        }
        setItems(list)
      })
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, profile.id])

  const cur = items[idx]
  const isLast = idx >= items.length - 1

  // 进卡自动播：播完设置的遍数就停，写完由孩子手动翻下一个
  useEffect(() => {
    if (!started || !cur || finished) return
    let cancelled = false
    const token = ++playToken.current
    ;(async () => {
      setPlaying(true)
      prefetchAhead(items, idx, 3)
      await new Promise(r => setTimeout(r, 250))
      if (cancelled || token !== playToken.current) return
      const rep = Math.max(1, progress.settings.repeat)
      const rate = resolveRate(false, progress.settings.rate)
      for (let i = 0; i < rep; i++) {
        if (cancelled || token !== playToken.current) return
        await playWord(cur, rate)
        if (i < rep - 1) await new Promise(r => setTimeout(r, 700))
      }
      if (!cancelled && token === playToken.current) setPlaying(false)
    })()
    return () => { cancelled = true; pauseAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cur, started, finished])

  /** 手动重播（正常速 / 慢速）：先 ++token 打断自动播，避免抢播放通道 */
  const replay = async (slow = false) => {
    if (!cur) return
    playToken.current++
    pauseAll()
    setSlowMode(slow)
    setPlaying(true)
    await playWord(cur, resolveRate(slow, progress.settings.rate))
    setPlaying(false)
  }

  const next = () => {
    if (isLast) { setFinished(true); return }
    setSlowMode(false)
    setIdx(i => i + 1)
  }

  const prev = () => {
    if (idx === 0) return
    setSlowMode(false)
    setIdx(i => i - 1)
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

  // 音频开始门（微信拦自动播放）：「点开始」本身就是手势
  if (!started) {
    return (
      <Shell title={`纸听 · ${track.label || track.id}`} back noNav>
        <AudioGate
          onStart={() => setStarted(true)}
          title="纸听模式：写在纸上"
          tip={`点开始后自动读第 1 个词（共 ${items.length || '…'} 个）。屏幕上不会出现任何单词——听一个，在本子上写一个。`}
        />
      </Shell>
    )
  }

  // 播完：引导去纸质批改（答案锁在家长解锁码后面）
  if (finished) {
    return (
      <Shell title="纸听完成" back noNav>
        <div className="card pad center" style={{ maxWidth: 440, margin: '24px auto' }}>
          <div style={{ fontSize: 40 }}>📋</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>
            播完了，{items.length} 行都写上了吗？
          </div>
          <div className="sub small" style={{ marginTop: 8, lineHeight: 1.8 }}>
            下一步对照答案：打开「纸质批改」，逐行打勾，分数自动记进家长看板。
            <br />（答案锁在家长解锁码后面，孩子自己看不到）
          </div>
          <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" style={{ background: 'var(--blue)', minWidth: 170, minHeight: 50 }}
              onClick={() => nav('/paper/' + track.id)}>
              📷 去纸质批改
            </button>
            <button className="btn ghost" style={{ minHeight: 50 }} onClick={() => nav('/')}>回首页</button>
          </div>
          <div className="sub small" style={{ marginTop: 12, lineHeight: 1.7 }}>
            小知识：本子的第 N 行就是今天纸质卷的第 N 题（同一天同一任务，顺序完全一致）。
          </div>
        </div>
      </Shell>
    )
  }

  if (!cur) {
    return (
      <Shell title="纸听" back>
        <div className="empty"><div className="i">⏳</div><div>词单准备中…</div></div>
      </Shell>
    )
  }

  const pct = Math.round(((idx + 1) / items.length) * 100)

  return (
    <Shell title={`纸听 · ${track.label || track.id}`} back sub={`${idx + 1}/${items.length}`} noNav>
      <div className="qbar">
        <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
      </div>

      <div className="playbox" style={{ padding: '30px 18px' }}>
        {/* 只显示播放序号（= 本子行号 = 打印卷题号），不显示任何单词/中文 */}
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2 }}>第 {idx + 1} 个</div>
        <div className="sub small" style={{ marginTop: 4 }}>
          共 {items.length} 个 · 写在本子第 {idx + 1} 行
        </div>
        <button
          className={'bigplay' + (playing ? ' playing' : '')}
          style={{ margin: '18px auto 6px' }}
          onClick={() => replay(false)}
          aria-label="重播"
        >{playing ? '♪' : '🔊'}</button>
        <div style={{ fontSize: 12, color: 'var(--sub)' }}>点 🔊 再听一次 · 已播 {progress.settings.repeat} 遍</div>
        <button
          className={'btn ghost sm' + (slowMode ? ' on' : '')}
          style={{ marginTop: 10 }}
          onClick={() => replay(true)}
          title="用 0.6 倍速慢放"
        >🐢 没听清？慢速再放一遍</button>
      </div>

      <div className="controls">
        <button className="btn ghost" onClick={prev} disabled={idx === 0}>‹ 上一个</button>
        <button className="btn" style={{ background: 'var(--blue)', minWidth: 140 }} onClick={next}>
          {isLast ? '📋 播完了' : '写好了，下一个 →'}
        </button>
      </div>

      <div className="sub small center" style={{ marginTop: 10, lineHeight: 1.7 }}>
        本子第 {idx + 1} 行 = 今天纸质卷第 {idx + 1} 题，家长批改时直接对照。
      </div>
    </Shell>
  )
}
