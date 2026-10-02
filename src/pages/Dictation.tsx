import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { getTrack, getTrackAny, loadAudioIndex, tuplesToItems, wordFileMap, playWordText } from '../lib/data'
import { playWord, stopAll, prefetchAhead, pauseAll, resolveRate, unlockAudio } from '../lib/player'
import { seededShuffle, makeSeed, newSalt, orderSalt, orderEpoch } from '../lib/shuffle'
import { weekStartStr } from '../lib/storage'
import { currentSalt, currentShuffleMode, fetchShuffleSalt, createShare, uploadPhoto, paperFileUrl } from '../lib/api'
import { sharePoster } from '../lib/poster'
import PinGate from '../components/PinGate'
import AudioGate from '../components/AudioGate'
import LetterKeyboard from '../components/LetterKeyboard'
import { todayStr } from '../lib/storage'
import type { AnswerRecord, AudioItem, Track } from '../types'

/** 自定义错词卷（错词本勾选 → /d/custom）：一个合成的任务壳 */
const CUSTOM_TRACK: Track = {
  id: 'custom', kind: 'daily', group: 'daily', order: 0, label: '错词听写',
  file: '', seconds: 0, wordCount: 0, sections: [], items: [],
}

/** 秒 → 中文时长 */
function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const ss = s % 60
  return m ? `${m}分${ss}秒` : `${ss}秒`
}

/** 拍照压缩：最长边 1280 / jpeg 0.8（手机原图动辄 4-8MB，直接传容易被 5MB 上限拒） */
async function compressImage(file: File): Promise<File> {
  try {
    const img = await createImageBitmap(file)
    const max = 1280
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    if (scale >= 1 && file.size < 2 * 1024 * 1024) return file
    const w = Math.round(img.width * scale)
    const h = Math.round(img.height * scale)
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/jpeg', 0.8))
    if (!blob) return file
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

export default function Dictation() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, recordAnswer, submitSession, updateSettings, profile, markPlanDone } = useStore()
  /** 内置 26 键键盘（默认开）：杜绝输入法联想把整词弹出来 */
  const kb = progress.settings.kbBuiltIn !== false
  // /d/custom：错词本勾选的自定义词单（sessionStorage 传入）
  const isCustom = id === 'custom'
  // 静态任务同步可得；plan（每日计划）/ mix（智能混合卷）由 effect 异步合成
  const [track, setTrack] = useState<Track | undefined>(() =>
    isCustom ? CUSTOM_TRACK : getTrack(id)
  )

  // 动态任务加载（/d/plan、/d/mix）
  useEffect(() => {
    if (isCustom) return
    let cancel = false
    void getTrackAny(id).then(t => {
      if (!cancel && t) setTrack(t)
    })
    return () => { cancel = true }
  }, [id, isCustom])

  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'ask' | 'done'>('ask')
  const [visible, setVisible] = useState(false)   // 是否已显示释义（防泄题：先听后看）
  const [result, setResult] = useState<{ score: number; right: number; total: number; newly: unknown[]; seconds: number; attemptNo: number } | null>(null)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [playing, setPlaying] = useState(false)
  const [items, setItems] = useState<AudioItem[]>([])
  const [salt, setSalt] = useState('')            // 手动重新洗牌的扰动
  const [slowMode, setSlowMode] = useState(false) // 慢速播放高亮
  const startedAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  // 音频开始门：微信会拦截无手势的自动播放，第一题必须由「点我开始」触发
  const [started, setStarted] = useState(false)
  // 预备页（v2.7）：learn 页学完回来会带 skip-prep 标记；错词加练卷不设预备页
  const [prepSkipped] = useState(() => {
    try { return sessionStorage.getItem('skip-prep-' + id) === '1' } catch { return false }
  })

  /** 点开始：解锁音频通道 + 计时从这一刻起算（门上等待的时间不算用时） */
  const start = () => {
    setStarted(true)
    startedAt.current = Date.now()
  }

  // 加载词单并按种子洗牌
  useEffect(() => {
    if (!track) return
    let cancel = false

    // ── 自定义错词卷：sessionStorage 词单 + 全词库真音频映射 ──
    if (isCustom) {
      wordFileMap().then(map => {
        if (cancel) return
        let list: AudioItem[] = []
        try {
          const cw = sessionStorage.getItem('custom-words')
          if (cw) list = (JSON.parse(cw) as { word: string; cn: string }[]).map((w, i) => ({
            no: i + 1, word: w.word, cn: w.cn, file: map.get(w.word) || null,
          }))
          sessionStorage.removeItem('custom-words')
        } catch { /* ignore */ }
        if (list.length > 1) {
          const mode = currentShuffleMode()
          const epoch = orderEpoch(mode, todayStr(), weekStartStr())
          const baseSalt = orderSalt(mode, weekStartStr(), currentSalt())
          const combined = salt ? (baseSalt ? `${baseSalt}|${salt}` : salt) : baseSalt
          list = seededShuffle(list, makeSeed(epoch, profile.id, 'custom', combined))
        }
        setItems(list)
        setReady(true)
      })
      return () => { cancel = true }
    }

    // 先拉一次云端盐+顺序模式（家长重排/切档后，下次进页立刻生效；离线时用本地缓存）
    fetchShuffleSalt().finally(() => {
      if (cancel) return
      Promise.all([loadAudioIndex(), wordFileMap()]).then(([idxMap, fmap]) => {
        if (cancel) return
        const fromAudio = idxMap[track.id]
        let list: AudioItem[]
        if (fromAudio && fromAudio.length) {
          // 用音频清单里的条目（含 file），保留原始中文
          list = fromAudio.map((a, i) => ({
            no: a.no ?? i + 1,
            word: a.word,
            cn: a.cn || track.items[i]?.[2] || '',
            file: a.file,
          }))
        } else {
          // 动态任务（每日计划/智能混合卷）不在音频清单里：
          // 用任务自带词单 + 全词库逐词音频映射（没有文件的词走 Web Speech）
          list = tuplesToItems(track.items).map(it => ({
            ...it, file: fmap.get(it.word) || null,
          }))
        }
        // 随机出题：同一天同一人顺序稳定；不同天/不同人/重排后顺序不同
        if (progress.settings.shuffle && list.length > 1) {
          const mode = currentShuffleMode()
          const epoch = orderEpoch(mode, todayStr(), weekStartStr())
          const baseSalt = orderSalt(mode, weekStartStr(), currentSalt())
          // 与打印卷/批改页同种子（同盐+同模式+同时间成分）——本地「换个顺序」的扰动
          // 为空串时不拼接，避免 weekly 出现 'x|' ≠ 'x' 的尾随差异
          const combined = salt ? (baseSalt ? `${baseSalt}|${salt}` : salt) : baseSalt
          const seed = makeSeed(epoch, profile.id, track.id, combined)
          list = seededShuffle(list, seed)
        }
        // 错词加练：sessionStorage 单次传递的词单，命中则只练这些词
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
        setReady(true)
      })
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

  // 每次切题时递增，用来「打断」正在进行的自动播报
  const playToken = useRef(0)

  // 每进入一题，自动播报（必须等「点我开始」解锁音频后才允许）
  useEffect(() => {
    if (!started || !cur || phase !== 'ask') return
    let cancelled = false
    const token = ++playToken.current
    ;(async () => {
      setVisible(false)
      setPlaying(true)
      // 提前缓冲后面几题，减少等待
      prefetchAhead(items, idx, 3)
      await new Promise(r => setTimeout(r, 250))
      // 若期间切了题 / 点了手动播放，本次自动播报作废
      if (cancelled || token !== playToken.current) return
      const rep = Math.max(1, progress.settings.repeat)
      const baseRate = resolveRate(false, progress.settings.rate)
      for (let i = 0; i < rep; i++) {
        if (cancelled || token !== playToken.current) return
        await playWord(cur, baseRate)
        if (i < rep - 1) await new Promise(r => setTimeout(r, 700))
      }
      if (!cancelled && token === playToken.current) setPlaying(false)
    })()
    return () => {
      cancelled = true
      // 只在「真的切走了」时打断声音；否则会误杀用户手动点的播放
      pauseAll()
    }
  }, [idx, cur, phase, started])

  // 自动聚焦
  useEffect(() => {
    if (phase === 'ask') setTimeout(() => inputRef.current?.focus(), 100)
  }, [idx, phase, visible])

  // 切题时复位「慢速」高亮
  useEffect(() => { setSlowMode(false) }, [idx])

  const pct = items.length ? Math.round(((idx + (phase === 'done' ? 1 : 0)) / items.length) * 100) : 0

  /**
   * 手动播放 / 重播。
   *
   * 关键：先 ++playToken 打断自动播报，否则两边会抢同一个播放通道，
   * 表现为「点了没反应」。
   */
  const replay = async (slow = false) => {
    if (!cur) return
    playToken.current++          // 作废正在进行的自动播报
    pauseAll()                   // 立刻停掉当前声音
    setPlaying(true)
    const rate = resolveRate(slow, progress.settings.rate)
    await playWord(cur, rate)
    setPlaying(false)
  }

  const showMeaning = () => {
    setVisible(true)
    void playWord(cur, 0.9)
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
    // 当天第几次做这个任务：防「乱填一遍看答案 → 截图 → 重做刷分」，
    // 家长在结果页/分享页能看到「当天第 N 次」，重做出来的分数藏不住
    const today = todayStr()
    const attemptNo = progress.history.filter(
      h => h.trackId === track.id && todayStr(new Date(h.at)) === today
    ).length + 1
    const { newly } = submitSession(track, recs, sec)
    // 每日计划：整卷做完才推进到这一天（中途交卷/跳题不算完成，不跳词）
    if (track.id === 'plan' && recs.length >= track.items.length) {
      markPlanDone(track.order)
    }
    setResult({ score, right, total, newly, seconds: sec, attemptNo })
    setPhase('done')
  }

  if (!track) {
    // plan/mix 是异步合成的，短暂等待属正常；其他 id 找不到才是真没有
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

  // ── 空词单（v3.2）：如 /d/review 在队列清空后再点进来——
  //    不能卡「词单准备中…」死循环，更不能走完流程上报一张 0 词空卷污染统计 ──
  if (track && items.length === 0 && !isCustom) {
    return (
      <Shell title={track.label || '没有题目'} back>
        <div className="empty">
          <div className="i">🍃</div>
          <div>现在没有要做的词</div>
          <div className="sub small" style={{ marginTop: 6 }}>
            复习队列清空了。明天学新词、听写答题后会自动排进新的复习。
          </div>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  // ── 错词加练：只重练本次答错的词（换盐触发重载 → 读取 retrain-words 过滤）──
  const onRetrain = () => {
    if (!track) return
    const wrongWords = [...new Set(answers.filter(a => !a.correct).map(a => a.word))]
    if (!wrongWords.length) return
    try { sessionStorage.setItem('retrain-words', JSON.stringify(wrongWords)) } catch { /* ignore */ }
    setResult(null); setIdx(0); setInput(''); setAnswers([]); setPhase('ask')
    startedAt.current = Date.now()
    setSalt(newSalt())
    window.scrollTo({ top: 0 })
  }

  // ── 预备页（v2.7）：先学一遍（可跳过）或直接听写，两个按钮平级、无诱导 ──
  // 「先学一遍」去 /learn/:id（学完回来带 skip-prep 标记）；「直接听写」本身就是手势，
  // 在这里解锁音频通道，不再多显示一次「点我开始」。
  // prepMode（v2.8 家长管控）：recommended 可跳过 / force 强制先学（藏跳过按钮）/ off 不预习
  const prepMode = progress.settings.prepMode || 'recommended'
  if (!started && !result && !prepSkipped && !isCustom && prepMode !== 'off') {
    const wrongHits = items.filter(i => progress.wrong[i.word]).length
    const learnedToday = (() => {
      const l = progress.learned[id]
      return l && todayStr(new Date(l.at)) === todayStr()
    })()
    return (
      <Shell title={track.label || `第 ${track.order} 天`} back noNav>
        <div className="card pad center" style={{ maxWidth: 440, margin: '24px auto' }}>
          <div style={{ fontSize: 40 }}>📝</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>
            {items.length ? `今天要听写 ${items.length} 个词` : '词单准备中…'}
          </div>
          <div className="sub small" style={{ marginTop: 6, lineHeight: 1.8 }}>
            {wrongHits > 0
              ? <>其中有 <b style={{ color: 'var(--bad)' }}>{wrongHits}</b> 个词你之前错过，建议先学一遍</>
              : '第一次见这些词？先花两分钟过一遍，听写时更有底。'}
            {learnedToday && <div style={{ marginTop: 4, color: 'var(--ok)' }}>✓ 今天已经学过一遍了</div>}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn"
              style={{ background: 'var(--blue)', minWidth: 170, minHeight: 50 }}
              onClick={() => nav('/learn/' + track.id)}
            >📖 先学一遍</button>
            {prepMode !== 'force' && (
              <button
                className={'btn' + (learnedToday ? '' : ' ghost')}
                style={learnedToday ? { background: 'var(--ok)', minWidth: 170, minHeight: 50, color: '#fff' } : { minWidth: 170, minHeight: 50 }}
                onClick={() => { unlockAudio(); start() }}
              >▶ 我已熟悉，直接听写</button>
            )}
          </div>
          <div className="sub small" style={{ marginTop: 12 }}>
            {prepMode === 'force'
              ? '家长要求：每天第一次听写前，先把今天的词过一遍。'
              : '预习是可选的——已经掌握的孩子直接听写就行。'}
            <br />想写在纸上？手边放好听写本，听到一个写一个，一行一个。
          </div>
          {/* 纯纸听（v2.9）：屏幕只放音频不显示任何单词，孩子在纸上写，
              写完去纸质批改。不用在屏幕上重复打字 */}
          <div style={{ marginTop: 14 }}>
            <button className="btn ghost" style={{ width: '100%' }} onClick={() => nav('/listen/' + track.id)}>
              📄 只放音频，写在纸上（不用打字）
            </button>
            <div className="sub small" style={{ marginTop: 4 }}>
              适合想练手写的时候：屏幕不显示单词，听到哪个写哪个，写完拍照批改。
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  // ── 音频开始门：微信内置浏览器会拦截无手势的自动播放（表现为「没声音」），
  //    第一题必须在真实点按之后才开始读 ──
  if (!started && !result) {
    return (
      <Shell title={track.label || `第 ${track.order} 天`} back noNav>
        <AudioGate
          onStart={start}
          title="准备好听写了吗？"
          tip="点按钮后系统自动读第一题，听完在这里写英文。"
        />
      </Shell>
    )
  }

  // ── 结果页 ──
  if (result) {
    return <ResultView track={track} result={result} answers={answers} profile={profile} onHome={() => nav('/')} onRetrain={onRetrain} />
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
          {/* BrowserRouter 下必须用 <Link>；href="#/..." 是 hash 写法，点了不会跳转 */}
          <Link className="btn ghost sm" style={{ fontSize: 12 }} to={`/print/${track.id}`}>🖨️ 打纸质卷</Link>
        </div>
      </div>

      <div className="playbox">
        {/* 纸质伴写（v2.9 重做）：不显示题号——题号是词单原始编号，跟洗牌后的播放顺序、
            打印卷的重新编号都对不上，只会误导。只提示「边听边写」，行号由播放顺序天然决定 */}
        {progress.settings.syncPaper !== false && (
          <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 6 }}>
            ✍️ 边听边写：听到一个，就在本子上写一个，一行一个
          </div>
        )}
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
          inputMode={kb ? 'none' : 'text'}
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
        <button
          className={'btn ghost' + (slowMode ? ' on' : '')}
          onClick={() => { setSlowMode(true); replay(true) }}
          title="用 0.6 倍速慢放"
        >🐢 慢速</button>
        <button className="btn ghost" onClick={() => { setPhase('done'); if (!answers.some(a => a.no === cur.no)) { const rec = { no: cur.no, word: cur.word, cn: cur.cn, input, correct: false }; recordAnswer(cur.word, cur.cn, input, false); setAnswers(a => [...a, rec]) } }}>跳过</button>
      </div>

      <div className="center mt">
        <button className="btn ghost sm" onClick={finish}>结束并交卷</button>
      </div>
    </Shell>
  )
}

function ResultView({ track, result, answers, profile, onHome, onRetrain }: {
  track: ReturnType<typeof getTrack>
  result: { score: number; right: number; total: number; newly: unknown[]; seconds: number; attemptNo: number }
  answers: AnswerRecord[]
  profile: { id: string; name: string; emoji: string; color: string }
  onHome: () => void
  onRetrain: () => void
}) {
  const nav = useNavigate()
  const { progress, awardDailyBonus } = useStore()
  const wrongs = answers.filter(a => !a.correct)
  const [shareHint, setShareHint] = useState('')
  // 纸质伴写照片（v2.7）：拍听写本 → 传 R2 → 分享链接里带给孩子家长的「手写痕迹」
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [bonusMsg, setBonusMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const emoji = result.score === 100 ? '🏆' : result.score >= 90 ? '🎉' : result.score >= 70 ? '👍' : result.score >= 50 ? '💪' : '📖'
  const word = result.score === 100 ? '完美通关！' : result.score >= 90 ? '太棒了！' : result.score >= 70 ? '不错，继续加油' : result.score >= 50 ? '还差一点' : '多练几遍就熟了'

  /** 选了照片：逐张压缩上传到 R2（papers/{sid}/{dayKey}/），成功后判「三格全齐」加分 */
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !track) return
    setUploading(true)
    setUploadMsg(`上传中…（0/${files.length}）`)
    const keys: string[] = []
    for (let i = 0; i < files.length && i < 3; i++) {
      const small = await compressImage(files[i])
      const k = await uploadPhoto(small, profile.id)
      if (k) keys.push(k)
      setUploadMsg(`上传中…（${i + 1}/${files.length}）`)
    }
    setUploading(false)
    if (keys.length) {
      setPhotos(p => [...p, ...keys])
      setUploadMsg(`已附上 ${keys.length} 张手写照片，分享链接里家长能看到`)
      // 三格奖励：今天这个任务预习过 + 已听写（进到本页即已提交）+ 有照片 → +10
      if (awardDailyBonus(track.id)) {
        setBonusMsg('🎉 预习 + 听写 + 手写照片三格全齐，积分 +10')
      }
    } else {
      setUploadMsg('上传没成功（网络不通？），可以稍后再拍——不影响成绩')
    }
  }

  /** 生成只读分享链接（微信里直接发链接，点开看对错 + 手写照片，不用截图） */
  const makeShare = async () => {
    setShareHint('生成中…')
    const url = await createShare({
      v: 1,
      studentName: profile.name,
      emoji: profile.emoji,
      title: `听写结果 · ${track?.label || track?.id || ''}`,
      date: todayStr(),
      score: result.score,
      sessions: 1,
      total: result.total,
      right: result.right,
      wrongs: wrongs.map(w => ({ word: w.word, cn: w.cn })),
      photoKeys: photos,
      attemptNo: result.attemptNo,
    })
    if (!url) { setShareHint('生成失败：网络不通，可改用「生成成绩海报」'); return }
    try {
      await navigator.clipboard.writeText(url)
      setShareHint('链接已复制，去微信粘贴发送即可')
    } catch {
      setShareHint(url)
    }
  }

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
          <div className="lab" style={{
            marginTop: 8, fontSize: 13, fontWeight: 600,
            color: result.attemptNo > 1 ? '#b45309' : 'var(--sub)',
          }}>
            {result.attemptNo > 1
              ? `⚠️ 这是今天第 ${result.attemptNo} 次做这个任务（家长看板 / 分享页可见）`
              : '今天第 1 次做这个任务'}
          </div>
        </div>
      </div>

      {/* 纸质伴写（v2.7）：拍听写本给家长看「手写痕迹」，分享链接里带原图 */}
      {progress.settings.syncPaper !== false && track && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 4 }}>📸 拍一下你的听写本</div>
          <div className="sub small" style={{ lineHeight: 1.7 }}>
            把今天写在听写本上的这几行拍给我，和成绩一起发给家长——
            屏幕的分数说明水平，纸上的字迹说明过程。
          </div>
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {photos.map(k => (
                <img key={k} src={paperFileUrl(k)} alt="手写照片"
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </div>
          )}
          {uploadMsg && <div className="sub small" style={{ marginTop: 8, color: 'var(--ok)' }}>{uploadMsg}</div>}
          {bonusMsg && (
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: 'var(--ok)' }}>{bonusMsg}</div>
          )}
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment" multiple
            style={{ display: 'none' }} onChange={e => void onPick(e)}
          />
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {photos.length ? '📷 再拍一张' : '📷 选照片 / 拍照'}
            </button>
            {photos.length > 0 && (
              <button className="btn" style={{ background: '#07c160' }} onClick={makeShare}>🔗 生成分享链接（带照片）</button>
            )}
          </div>
        </div>
      )}

      {/* 巩固闭环：翻译关 + 跟读 + 错词加练（自定义错词卷没有对应任务，隐藏这两个入口） */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {track && (getTrack(track.id) || track.id === 'plan' || track.id === 'mix') && (
          <button className="btn" style={{ background: 'var(--blue)' }} onClick={() => nav(`/translate/${track.id}`)}>
            🔤 进入翻译关
          </button>
        )}
        {track && (
          <button className="btn" style={{ background: '#7048e8' }} onClick={() => nav(`/spell/${track.id}`)}>
            ✏️ 首字母填空
          </button>
        )}
        <button className="btn" style={{ background: '#7048e8' }} onClick={() => nav('/forms/all')}>
          📝 词形变换
        </button>
        {track && getTrack(track.id) && (
          <button className="btn" style={{ background: '#7048e8' }} onClick={() => nav(`/read/${track.id}`)}>
            🎙️ 跟读录音
          </button>
        )}
        {wrongs.length > 0 && (
          <button className="btn gold" onClick={onRetrain}>
            ⚡ 错词加练（{wrongs.length} 词）
          </button>
        )}
      </div>
      {track && (getTrack(track.id) || track.id === 'plan' || track.id === 'mix') && (
        <div className="sub small center" style={{ marginTop: 6 }}>
          翻译关换个方向再过一遍{getTrack(track.id) ? ' · 跟读录下来发给家长听' : ''}
        </div>
      )}

      {/* 分享：链接为主（点开看对错），海报兜底 */}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn" style={{ background: '#07c160' }} onClick={makeShare}>🔗 分享链接（发微信）</button>
        <button
          className="btn ghost"
          onClick={() => sharePoster({
            profile, trackLabel: track?.label || track?.id || '', date: todayStr(),
            score: result.score, right: result.right, total: result.total, seconds: result.seconds,
            answers: answers.map(a => ({ word: a.word, cn: a.cn, correct: a.correct, input: a.input })),
          })}
        >📤 海报</button>
      </div>
      {shareHint && (
        <div className="tip" style={{ background: '#e7f5ee', color: '#0b7285', wordBreak: 'break-all' }}>{shareHint}</div>
      )}

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

      {/* 孩子版错词卡（v3.2）：只给序号 + 中文释义 + 发音，绝不显示英文拼写——
          否则孩子截图答案再重做就是刷分（完整拼写明细在下面 PinGate 里，家长解锁才可见）。
          重听按钮复用 onRetrain（retrain-words 过滤重载） */}
      {wrongs.length > 0 ? (
        <div className="card pad" style={{ borderColor: '#f0b7b7' }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            ❌ 这次错了 {wrongs.length} 个
            <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>已自动进错词本</span>
          </div>
          <div className="sub small" style={{ marginBottom: 8 }}>
            先点 🔊 听发音，看能不能想起来这个词怎么写。
          </div>
          <div className="reviewlist">
            {wrongs.map(a => (
              <div key={a.no} className="rv">
                <span className="mk" style={{ color: 'var(--bad)' }}>{a.no}</span>
                <span className="w">{a.cn}</span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 12, flexShrink: 0 }}
                  onClick={() => playWordText(a.word)} aria-label="听发音">🔊</button>
              </div>
            ))}
          </div>
          <button className="btn gold" style={{ marginTop: 10, width: '100%' }} onClick={onRetrain}>
            ⚡ 只重听错词（{wrongs.length} 词）
          </button>
        </div>
      ) : (
        <div className="card pad center" style={{ background: 'var(--ok-soft)' }}>
          <div style={{ fontSize: 30 }}>🎉</div>
          <div style={{ fontWeight: 800, color: 'var(--ok)' }}>全部答对，太棒了！</div>
        </div>
      )}

      {/* 防刷分：错词与对错明细里含正确拼写，锁在家长解锁码后面。
          否则孩子乱填一遍 → 结果页截图全部答案 → 重做刷 100 分 */}
      <PinGate title="错词明细需家长解锁">
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
                  <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 12, flexShrink: 0 }}
                    onClick={() => playWordText(a.word)} aria-label="读这个词">🔊</button>
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
                <span className="sub small">{a.cn}</span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 12, flexShrink: 0 }}
                  onClick={() => playWordText(a.word)} aria-label="读这个词">🔊</button>
              </div>
            ))}
          </div>
        </div>
      </PinGate>

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
