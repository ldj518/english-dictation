import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems } from '../lib/data'
import { playWord, pauseAll, resolveRate } from '../lib/player'
import { seededShuffle, makeSeed, orderSalt, orderEpoch } from '../lib/shuffle'
import { todayStr, weekStartStr } from '../lib/storage'
import { currentSalt, currentShuffleMode, fetchShuffleSalt, uploadRecording, createShare } from '../lib/api'
import AudioGate from '../components/AudioGate'
import FlowNextBar from '../components/FlowNextBar'
import { isFlowTaskId } from '../lib/flow'
import type { AudioItem, Track } from '../types'

/**
 * 跟读录音：每个单词放标准音 → 孩子自己读一遍录下来 → 可回放对比 → 上传。
 *
 * - 不是测验：单词直接显示（朗读练习的目的是开口，不是考拼写）
 * - 录音存 R2（records/ 前缀），家长在「家长看板」或分享链接里直接听
 * - 不计入对错统计（分数照实算的原则：没作答就不造假分数）
 */

interface Take {
  blob: Blob
  url: string
  ext: string
  seconds: number
}

type UpState = 'pending' | 'uploading' | 'done' | 'failed'

/** 挑浏览器能用的录音格式：webm(opus) 优先，iPhone Safari 走 mp4 */
function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const c of candidates) {
    try { if (MediaRecorder.isTypeSupported(c)) return c } catch { /* ignore */ }
  }
  return ''
}

function extOf(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

const MAX_SEC = 8 // 单词跟读 8 秒足够，自动停

export default function Read() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { profile, progress, advanceFlow } = useStore()
  // plan/mix 是动态合成的（v3.5.1 修复：闯关第 3 关 /read/plan 之前 getTrack 查不到 →「没有这个任务」）
  const [track, setTrack] = useState<Track | undefined>(() => getTrack(id))
  useEffect(() => {
    if (getTrack(id)) return
    let cancel = false
    void getTrackAny(id).then(t => { if (!cancel && t) setTrack(t) })
    return () => { cancel = true }
  }, [id])

  const [items, setItems] = useState<AudioItem[]>([])
  const [idx, setIdx] = useState(0)
  const [takes, setTakes] = useState<(Take | null)[]>([])
  const [recording, setRecording] = useState(false)
  const [recSec, setRecSec] = useState(0)
  const [recErr, setRecErr] = useState('')
  const [phase, setPhase] = useState<'read' | 'finish'>('read')
  const [upStates, setUpStates] = useState<UpState[]>([])
  const [shareHint, setShareHint] = useState('')
  const [shareUrl, setShareUrl] = useState('')

  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playToken = useRef(0)
  // 音频开始门：微信拦截无手势自动播放
  const [started, setStarted] = useState(false)

  // 加载词单（时间成分+盐，与听写卷同源）
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
        if (list.length > 1) {
          const mode = currentShuffleMode()
          const epoch = orderEpoch(mode, todayStr(), weekStartStr())
          const s = orderSalt(mode, weekStartStr(), currentSalt())
          list = seededShuffle(list, makeSeed(epoch, profile.id, track.id + '-r', s))
        }
        setItems(list)
        setTakes(new Array(list.length).fill(null))
        setUpStates(new Array(list.length).fill('pending'))
      })
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, profile.id])

  const cur = items[idx]
  const curTake = takes[idx] || null

  // 进题自动播标准音（等开始门解锁后）
  useEffect(() => {
    if (!started || !cur || phase !== 'read') return
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

  // 卸载时清理麦克风/定时器/blob
  useEffect(() => () => {
    stopTimers()
    streamRef.current?.getTracks().forEach(t => t.stop())
    mrRef.current?.state === 'recording' && mrRef.current.stop()
  }, [])

  // 闯关第 3 关（v3.5）：进完成页即记账（不管录没录——本关可跳过，开了口就算过）
  useEffect(() => {
    if (phase === 'finish' && id === 'plan') advanceFlow(3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, id])

  function stopTimers() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null }
  }

  const replay = () => {
    if (!cur) return
    playToken.current++
    pauseAll()
    playWord(cur, resolveRate(false, progress.settings.rate))
  }

  const startRec = async () => {
    setRecErr('')
    if (!cur) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecErr('这个浏览器不支持录音。请点右上角「…」用浏览器打开，或换 Chrome / Edge。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        stopTimers()
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        const seconds = Math.round((Date.now() - startedAtRef.current) / 1000)
        setTakes(prev => {
          const next = [...prev]
          const old = next[idx]
          if (old) URL.revokeObjectURL(old.url)
          next[idx] = { blob, url: URL.createObjectURL(blob), ext: extOf(mr.mimeType || ''), seconds }
          return next
        })
        setRecording(false)
      }
      mrRef.current = mr
      startedAtRef.current = Date.now()
      setRecSec(0)
      mr.start()
      setRecording(true)
      // 计时显示
      timerRef.current = setInterval(() => setRecSec(s => s + 1), 1000)
      // 8 秒自动停（孩子忘点停止也不至于录一大段）
      autoStopRef.current = setTimeout(() => {
        if (mrRef.current?.state === 'recording') mrRef.current.stop()
      }, MAX_SEC * 1000)
    } catch {
      setRecErr('拿不到麦克风权限。请在浏览器设置里允许本网页使用麦克风。')
    }
  }

  const stopRec = () => {
    if (mrRef.current?.state === 'recording') mrRef.current.stop()
  }

  const next = () => {
    if (idx + 1 >= items.length) { setPhase('finish'); return }
    setIdx(i => i + 1)
  }

  /* ── 上传 + 分享（完成页）── */

  // 上传成功后的 key 列表（uploadAll 写入，makeShare 读取）
  const uploadedKeyRefs = useRef<string[]>([])

  const uploadAll = async () => {
    if (!track) return
    uploadedKeyRefs.current = new Array(items.length).fill('')
    const next = [...upStates]
    let did = false
    for (let i = 0; i < takes.length; i++) {
      const t = takes[i]
      if (!t || upStates[i] === 'done') continue
      next[i] = 'uploading'; setUpStates([...next]); did = true
      const key = await uploadRecording(t.blob, {
        studentId: profile.id, trackId: track.id, no: items[i].no, word: items[i].word, ext: t.ext,
      })
      next[i] = key ? 'done' : 'failed'
      if (key) uploadedKeyRefs.current[i] = key
      setUpStates([...next])
    }
    if (!did) setShareHint('还没有录任何一句，先回去补录吧')
  }

  const doneCount = upStates.filter(s => s === 'done').length
  const hasTakeCount = takes.filter(Boolean).length

  const makeShare = async () => {
    if (!track) return
    setShareHint('生成中…')
    const recordKeys = takes
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => t && upStates[i] === 'done')
      .map(({ i }) => ({ word: items[i].word, cn: items[i].cn, key: uploadedKeyRefs.current[i] }))
      .filter(r => r.key)
    const total = items.length
    const right = hasTakeCount
    const score = total ? Math.round((right / total) * 100) : 0
    const url = await createShare({
      v: 1, studentName: profile.name, emoji: profile.emoji,
      title: `跟读录音 · ${track.label || track.id}`,
      date: todayStr(), score, sessions: 1, total, right,
      wrongs: [], photoKeys: [], recordKeys,
    })
    if (!url) { setShareHint('生成失败：网络不通'); return }
    setShareUrl(url)
    try { await navigator.clipboard.writeText(url); setShareHint('链接已复制，去微信粘贴发送即可，家人点开就能听') }
    catch { setShareHint('长按复制下面这段地址发到微信：') }
  }

  if (!track) {
    return (
      <Shell title={id === 'plan' ? '准备词单' : '未找到'} back noNav>
        <div className="empty">
          <div className="i">{id === 'plan' ? '⏳' : '🤔'}</div>
          <div>{id === 'plan' ? '正在准备今天的词单…' : '没有这个任务'}</div>
        </div>
      </Shell>
    )
  }

  /* ── 完成页 ── */
  if (phase === 'finish') {
    return (
      <Shell title="跟读完成" back noNav>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{hasTakeCount === items.length ? '🌟' : '🎙️'}</div>
            <div className="num">{hasTakeCount}<span style={{ fontSize: 26 }}>/{items.length}</span></div>
            <div className="lab">录了 {hasTakeCount} 个词 · 上传成功 {doneCount} 个</div>
          </div>
        </div>

        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>逐条回放（标准音 vs 你的读音）</div>
          <div className="reviewlist">
            {items.map((it, i) => (
              <div key={it.no} className="rv" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="mk">{takes[i] ? '🎙️' : '·'}</span>
                <span className="w" style={{ minWidth: 70 }}>{it.word}</span>
                <span className="sub small">{it.cn}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => { playToken.current++; pauseAll(); playWord(it, 1) }}>🔊 标准</button>
                  {takes[i] && <audio controls preload="none" src={takes[i]!.url} style={{ height: 32 }} />}
                  {upStates[i] === 'done' && <span className="pill p-ok" style={{ fontSize: 11 }}>已上传</span>}
                  {upStates[i] === 'failed' && <span className="pill p-bad" style={{ fontSize: 11 }}>失败</span>}
                  {upStates[i] === 'uploading' && <span className="sub small">上传中…</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {doneCount < hasTakeCount && (
            <button className="btn" onClick={uploadAll}>⬆️ 上传录音（{hasTakeCount - doneCount} 条）</button>
          )}
          {doneCount > 0 && (
            <button className="btn" style={{ background: '#07c160' }} onClick={makeShare}>🔗 分享链接（发微信）</button>
          )}
          <button className="btn ghost" onClick={() => { setPhase('read'); setIdx(0) }}>← 回去补录</button>
        </div>
        {shareHint && <div className="tip" style={{ background: '#e7f5ee', color: '#0b7285', wordBreak: 'break-all' }}>{shareHint}</div>}
        {shareUrl && shareHint.startsWith('长按') && (
          <div className="tip" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{shareUrl}</div>
        )}

        {/* 闯关第 3 关（v3.5.1）：完成后引导下一关；plan 记账、dayXX 重学链；其他任务不显示 */}
        <FlowNextBar doneStep={3} taskId={isFlowTaskId(id) ? id : undefined} />

        <div className="sub small center" style={{ marginTop: 8, lineHeight: 1.7 }}>
          上传后：家长看板「🎙️ 跟读录音」和分享链接里都能直接听。<br />
          跟读不计对错分数，按录音条数算完成度。
        </div>
      </Shell>
    )
  }

  if (!cur) return <Shell title="跟读录音" back noNav><div className="empty sub">加载中…</div></Shell>

  // ── 音频开始门 ──
  if (!started) {
    return (
      <Shell title="跟读录音" back noNav>
        <AudioGate
          onStart={() => setStarted(true)}
          title="准备好跟读了吗？"
          tip="每个词：听标准音 → 你跟着读一遍 → 录下来发给家长听。"
        />
        {/* 闯关第 3 关（v3.5.1）：本关可跳过，不想开口的直接过；plan 记账、dayXX 只跳不记 */}
        {isFlowTaskId(id) && (
          <div className="center" style={{ marginTop: 4 }}>
            <button className="btn ghost" onClick={() => setPhase('finish')}>⏭ 不想读，跳过本关 →</button>
          </div>
        )}
      </Shell>
    )
  }

  const pct = items.length ? Math.round(((idx + 1) / items.length) * 100) : 0

  return (
    <Shell title="跟读录音" back sub={`${idx + 1}/${items.length}`} noNav>
      <div className="qbar">
        <div className="qhead">
          <span>跟读 <b>{idx + 1}</b> / {items.length}</span>
          <span>🎙️ 已录 {takes.filter(Boolean).length} 个</span>
        </div>
        <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
      </div>

      <div className="playbox">
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>听标准音 → 跟着读 → 录下来</div>
        <div className="wordBig">{cur.word}</div>
        <button className="bigplay" onClick={replay} aria-label="听标准音">🔊</button>
        <div style={{ fontSize: 12, color: 'var(--sub)' }}>{cur.cn}</div>

        {recording ? (
          <>
            <button className="bigplay" style={{ background: '#e03131', fontSize: 30 }} onClick={stopRec} aria-label="停止录音">
              ⏹
            </button>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e03131' }}>录音中 {recSec}s（最长 {MAX_SEC} 秒，自动停）</div>
          </>
        ) : curTake ? (
          <>
            <audio controls src={curTake.url} style={{ marginTop: 10, width: '100%', maxWidth: 320 }} />
            <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'center' }}>
              <button className="btn ghost sm" onClick={startRec}>🔄 重录</button>
              <button className="btn" onClick={next}>{idx + 1 >= items.length ? '完成 ✓' : '下一个 →'}</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 6 }}>先听自己的，觉得不像就重录一遍</div>
          </>
        ) : (
          <button className="btn" style={{ marginTop: 14, background: '#7048e8' }} onClick={startRec}>
            🎙️ 开始录音
          </button>
        )}

        {recErr && (
          <div className="tip" style={{ marginTop: 12, background: '#fff0f0', color: '#c92a2a' }}>{recErr}</div>
        )}
      </div>

      <div className="controls">
        <button className="btn ghost" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>‹ 上一词</button>
        <button className="btn ghost" onClick={next}>{curTake ? '跳过 →' : '下一个 →'}</button>
        <button className="btn ghost" onClick={() => setPhase('finish')}>{isFlowTaskId(id) ? '⏭ 结束跟读' : '结束上传'}</button>
      </div>
    </Shell>
  )
}
