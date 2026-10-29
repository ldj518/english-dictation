import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { audioUrl } from '../lib/assets'
import { pauseAll, unlockAudio } from '../lib/player'
import { getTextUnit, glossOf, groupParas, storyWords, tokenize } from '../lib/text'

/**
 * 课文页（v6）：读课本原文，点任意单词查意思并听读音。
 *
 * 定位：这是「读」不是「考」——
 *  - 英文直接显示，不搞防泄题（防泄题只约束听写屏，别串到这里）
 *  - 中文默认显示、可一键收起（先看懂再遮住，比反过来友好）
 *  - 词义查不到也照样能点读，只提示「暂无释义」，不假装有
 */
export default function Text() {
  const { unit } = useParams<{ unit: string }>()
  const u = getTextUnit(unit || '')
  const [si, setSi] = useState(0)
  const [showCn, setShowCn] = useState(true)
  const [sel, setSel] = useState<{ no: number; w: string } | null>(null)
  const [amap, setAmap] = useState<Record<string, string> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let alive = true
    fetch(audioUrl('text/manifest.json'))
      .then(r => (r.ok ? r.json() : {}))
      .then((m: Record<string, string>) => { if (alive) setAmap(m || {}) })
      .catch(() => { if (alive) setAmap({}) })
    return () => { alive = false }
  }, [])

  useEffect(() => () => {
    pauseAll()
    try { audioRef.current?.pause() } catch { /* ignore */ }
  }, [])

  const play = useCallback((w: string) => {
    const f = amap?.[w]
    if (!f) return
    if (!audioRef.current) audioRef.current = new Audio()
    const a = audioRef.current
    try {
      a.pause()
      a.src = audioUrl('text/' + f)
      void a.play().catch(() => { /* 无手势/无音频包时静默 */ })
    } catch { /* ignore */ }
  }, [amap])

  const pick = useCallback((no: number, w: string) => {
    unlockAudio()
    setSel(prev => (prev && prev.no === no && prev.w === w ? null : { no, w }))
    play(w)
  }, [play])

  const story = u?.stories[si] || u?.stories[0]
  const paras = useMemo(() => (story ? groupParas(story) : []), [story])
  const noGloss = useMemo(() => {
    if (!story) return 0
    return storyWords(story).filter(w => !glossOf(w)).length
  }, [story])
  const totalWords = useMemo(() => (story ? storyWords(story).length : 0), [story])

  if (!u || !story) {
    return (
      <Shell title="课文" back>
        <div className="empty"><div className="i">📖</div><div>这个单元的课文还没导入</div></div>
      </Shell>
    )
  }

  return (
    <Shell title="课文" back sub={'Unit ' + Number(u.unit.replace('unit', ''))}>
      <div className="card" style={{ padding: '16px 16px 6px' }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.35 }}>{story.title}</div>
        <div style={{ fontSize: 14, color: 'var(--sub)', marginTop: 4 }}>
          {story.titleCn} · {story.section} · {story.sents.length} 句
        </div>
        <div className="tbar" style={{ marginTop: 12 }}>
          {u.stories.map((s, i) => (
            <button
              key={s.id}
              className={'tbt' + (i === si ? ' on' : '')}
              onClick={() => { setSi(i); setSel(null) }}
            >{s.titleCn}</button>
          ))}
          <button
            className={'tbt' + (showCn ? ' on' : '')}
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowCn(v => !v)}
          >{showCn ? '中文 开' : '中文 关'}</button>
        </div>
      </div>

      <div className="card" style={{ padding: '18px 16px 8px', marginTop: 12 }}>
        {paras.map((ps, pi) => (
          <div className="tpara" key={pi}>
            <p className="ten">
              {ps.map((s, i) => (
                <span key={s.no}>
                  {tokenize(s.en).map((tk, ti) => (
                    tk.word ? (
                      <span
                        key={ti}
                        className={'tw' + (sel && sel.no === s.no && sel.w === tk.word ? ' on' : '')}
                        onClick={() => pick(s.no, tk.word as string)}
                      >{tk.text}</span>
                    ) : (
                      <span key={ti}>{tk.text}</span>
                    )
                  ))}
                  {i < ps.length - 1 ? ' ' : ''}
                </span>
              ))}
            </p>
            {showCn && <p className="tcn">{ps.map(s => s.cn).join('')}</p>}
            {sel && ps.some(s => s.no === sel.no) && (
              <div className="tword">
                <b>{sel.w}</b>
                <span>{glossOf(sel.w) || '暂无释义'}</span>
                <button className="tplay" onClick={() => play(sel.w)}>再听</button>
                <button className="tx" onClick={() => setSel(null)} aria-label="关闭">✕</button>
              </div>
            )}
          </div>
        ))}
        <div className="tfoot">
          点任意单词听读音 · 本篇 {totalWords} 个词形
          {noGloss > 0 ? ' · ' + noGloss + ' 个暂无释义' : ''}
        </div>
      </div>

    </Shell>
  )
}
