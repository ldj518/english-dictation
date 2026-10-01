import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { getTrack, loadAudioIndex, tuplesToItems, DAILY } from '../lib/data'
import { useStore } from '../lib/store'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import { todayStr } from '../lib/storage'
import { sharePoster } from '../lib/poster'
import type { AudioItem, AnswerRecord } from '../types'

/**
 * 纸质卷批改。
 *
 * 流程：家长把纸质卷拍照 → 逐题对照屏幕上的答案 → 点 ✓ / ✗ → 系统算分入库。
 * 不做 OCR：手写英文识别率不可靠，且会把家长搞得更累。
 * 照片只作为「批改参考底图」贴在顶部，对照着勾选，效率最高。
 */
export default function Paper() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { submitSession, profile } = useStore()
  const track = getTrack(id)

  const [items, setItems] = useState<AudioItem[]>([])
  const [photo, setPhoto] = useState<string>('')
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [result, setResult] = useState<{ score: number; right: number; total: number; newly: unknown[]; seconds: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!track) return
    let cancel = false
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
      list = seededShuffle(list, makeSeed(todayStr(), profile.id, track.id)) // 与打印卷顺序一致
      setItems(list)
    })
    return () => { cancel = true }
  }, [track, profile.id])

  const onPhoto = (f: File) => {
    const r = new FileReader()
    r.onload = () => setPhoto(String(r.result))
    r.readAsDataURL(f)
  }

  const mark = (word: string, ok: boolean) => setMarks(m => ({ ...m, [word]: ok }))
  const markAll = (ok: boolean) => {
    const m: Record<string, boolean> = {}
    items.forEach(i => { m[i.word] = ok })
    setMarks(m)
  }

  const doneCount = items.filter(i => marks[i.word] !== undefined).length

  const commit = () => {
    if (!track) return
    const recs: AnswerRecord[] = items.map((it, i) => ({
      no: i + 1,
      word: it.word,
      cn: it.cn,
      input: '',                       // 纸质作答，无输入内容
      correct: !!marks[it.word],
    }))
    const total = recs.length
    const right = recs.filter(r => r.correct).length
    const score = total ? Math.round((right / total) * 100) : 0
    // 纸质卷按每题 12 秒估算用时
    const sec = total * 12
    const { newly } = submitSession(track, recs, sec)
    setResult({ score, right, total, newly, seconds: sec })
  }

  if (!track) return <Shell title="未找到" back><div className="empty"><div className="i">🤔</div><div>没有这个任务</div></div></Shell>

  if (result) {
    const wrongs = items.filter(i => !marks[i.word])
    return (
      <Shell title="纸质卷批改结果" back noNav>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{result.score >= 90 ? '🎉' : result.score >= 70 ? '👍' : '💪'}</div>
            <div className="num">{result.score}<span style={{ fontSize: 26 }}>%</span></div>
            <div className="lab">纸质卷 · {profile.name}</div>
            <div className="lab" style={{ marginTop: 8 }}>
              答对 <b style={{ color: 'var(--ok)' }}>{result.right}</b> / {result.total}
              {' · '}答错 <b style={{ color: 'var(--bad)' }}>{result.total - result.right}</b>
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" style={{ background: '#07c160' }}
            onClick={() => sharePoster({
              profile, trackLabel: track.label + '（纸质）', date: todayStr(),
              score: result.score, right: result.right, total: result.total, seconds: result.seconds,
              answers: items.map((it, i) => ({ word: it.word, cn: it.cn, correct: !!marks[it.word], input: '' })),
            })}>
            📤 生成成绩海报
          </button>
        </div>
        {wrongs.length > 0 && (
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>❌ 错词 {wrongs.length} 个（已进错词本）</div>
            <div className="reviewlist">
              {wrongs.map((w, i) => (
                <div key={w.word + i} className="rv">
                  <span className="mk">✗</span>
                  <span className="w">{w.word}</span>
                  <span className="sub small">{w.cn}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn ghost" onClick={() => { setResult(null); setMarks({}) }}>重新批改</button>
          <button className="btn" onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell title="纸质卷批改" back sub={`${doneCount}/${items.length}`} noNav>
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>① 拍下孩子的纸质卷</div>
        <div className="sub small" style={{ marginBottom: 10 }}>
          照片只在本机显示，用于对照批改，不会上传。
        </div>
        {photo ? (
          <div className="photoBox">
            <img src={photo} alt="纸质卷照片" />
            <button className="btn ghost sm" onClick={() => setPhoto('')}>重拍</button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>📷 拍照 / 选照片</button>
        )}
        <input
          ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f) }}
        />
      </div>

      <div className="card pad">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>② 逐题对照，点 ✓ / ✗</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" onClick={() => markAll(true)}>全对</button>
            <button className="btn ghost sm" onClick={() => markAll(false)}>全错</button>
          </div>
        </div>
        <div className="marklist">
          {items.map((it, i) => (
            <div className={'mrow' + (marks[it.word] === undefined ? '' : marks[it.word] ? ' ok' : ' bad')} key={it.word + i}>
              <span className="mno">{String(i + 1).padStart(2, '0')}</span>
              <span className="mw">{it.word}</span>
              <span className="mcn">{it.cn}</span>
              <div className="mbtns">
                <button className={'mb ok' + (marks[it.word] === true ? ' on' : '')} onClick={() => mark(it.word, true)}>✓</button>
                <button className={'mb bad' + (marks[it.word] === false ? ' on' : '')} onClick={() => mark(it.word, false)}>✗</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="center mt" style={{ paddingBottom: 40 }}>
        <button className="btn" onClick={commit} disabled={doneCount < items.length}>
          {doneCount < items.length ? `还剩 ${items.length - doneCount} 题没勾` : '✓ 完成批改，算分入库'}
        </button>
      </div>
    </Shell>
  )
}
