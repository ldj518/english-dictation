/**
 * 单元闸门（v5 P4）。
 *
 * 和日常会话的区别：**测验不教，只量**。
 * 答错就直接给正确答案走人，不重做、不「抄一遍」——重做会把分数修好，
 * 那样测出来的就不是掌握度了，是家长想看的那个数。
 *
 * 触发条件在 gate.ts 里（四条），这里只管卷子和落库。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import LetterKeyboard from '../components/LetterKeyboard'
import { useStore } from '../lib/store'
import { todayStr, judge, judgeWithFirst } from '../lib/storage'
import { cnOf, judgeSentence, type Q } from '../lib/qbank'
import { dueWordList } from '../lib/memory'
import {
  buildPaper, gateOf, nextGate, gradePaper, makeRun, unitWords, unitName,
  GATE_PASS, SPELL_PASS, type TestItem,
} from '../lib/gate'
import { bjShort, fmtSec } from '../lib/bj'

type Phase = 'idle' | 'run' | 'wrap'

interface Rec { word: string; kind: string; correct: boolean; peek: boolean; ms: number; fast: boolean }


export default function Gate() {
  const nav = useNavigate()
  const { unit: routeUnit } = useParams()
  const { progress, saveTest, gradeOne } = useStore()
  const day = todayStr()

  const dueAll = useMemo(() => dueWordList(progress, day, cnOf).length, [progress, day])
  const target = useMemo(() => {
    if (routeUnit) return gateOf(progress, routeUnit, day, dueAll)
    return nextGate(progress, day, dueAll)
  }, [progress, day, dueAll, routeUnit])

  const [phase, setPhase] = useState<Phase>('idle')
  const [qs, setQs] = useState<Q[]>([])
  const [qi, setQi] = useState(0)
  const [recs, setRecs] = useState<Rec[]>([])
  const [input, setInput] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ idx: number; text: string }[]>([])
  const [pool, setPool] = useState<number[]>([])
  const [verdict, setVerdict] = useState<'' | 'ok' | 'bad'>('')
  const [showCn, setShowCn] = useState(false)
  const [peeked, setPeeked] = useState(false)
  const startAt = useRef(0)
  const savedRef = useRef('')

  const unit = target?.unit || routeUnit || ''
  const q: Q | null = phase === 'run' ? qs[qi] || null : null

  const start = useCallback(() => {
    if (!unit) return
    // 种子带「进入次数」：同一份卷子重进会换序，防按位置背答案
    const key = `gate-enter-${unit}-${day}`
    const n = Number(sessionStorage.getItem(key) || '0') + 1
    sessionStorage.setItem(key, String(n))
    const paper = buildPaper(progress, unitWords(unit), `${day}|${unit}|${n}`, 'gate')
    setQs(paper)
    setQi(0)
    setRecs([])
    setPhase('run')
    startAt.current = Date.now()
  }, [progress, unit, day])

  useEffect(() => {
    if (!q) return
    setInput(''); setSel(null); setVerdict(''); setShowCn(false); setPeeked(false)
    if (q.kind === 'sent' && q.tokens) {
      setPool(q.order ? q.order.slice() : q.tokens.map((_, i) => i))
      setPicked([])
    }
    startAt.current = Date.now()
  }, [qi, q?.id])

  const next = useCallback(() => {
    if (qi + 1 >= qs.length) { setPhase('wrap'); return }
    setQi(i => i + 1)
  }, [qi, qs.length])

  const record = useCallback((correct: boolean, peek = false) => {
    if (!q) return
    const ms = Date.now() - startAt.current
    setRecs(prev => [...prev, {
      word: q.word, kind: q.kind, correct: !peek && correct, peek, ms,
      fast: ms < 1500 && correct && !peek,
    }])
  }, [q])

  /** 结算：判卷 + 落库 + 判一次词（测验也要更新 S，否则队列永远不知道他考过了） */
  useEffect(() => {
    if (phase !== 'wrap' || !target) return
    const key = `${target.unit}|${day}`
    if (savedRef.current === key) return
    savedRef.current = key

    const r = gradePaper(recs)
    const attempt = (progress.tests || []).filter(t => t.kind === 'gate' && t.unit === target.unit).length + 1
    const run = makeRun('gate', target.unit, day, r, attempt, `${target.unit}-${day}-${Date.now()}`)
    // 逐题判词：对了记一次，错了也记一次（这就是补丁期该练的依据）
    const seen = new Set<string>()
    for (const x of recs) {
      if (seen.has(x.word)) continue
      seen.add(x.word)
      gradeOne(x.word, x.correct, { hinted: x.peek })
    }
    const items: TestItem[] = recs.map((x, i) => ({
      no: i + 1, word: x.word, qkind: x.kind,
      correct: x.correct, peek: x.peek, ms: x.ms, fast: x.fast,
    }))
    saveTest(run, items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /* ── 没到考的时候 ── */
  if (!target) {
    return (
      <Shell title="单元闸门" back>
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 6 }}>现在还不用考</div>
          <div className="sub small">到期词清完、这个单元练够一轮，闸门自己会开。不用提前刷卷。</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  if (phase === 'idle') {
    const st = target.stats
    return (
      <Shell title="单元闸门" back>
        <div className="card pad">
          <div style={{ fontSize: 17, fontWeight: 800 }}>{unitName(target.unit)} · 过关测</div>
          <div className="sub small" style={{ marginTop: 4 }}>
            {st.total} 个词，学过 {st.learned}，其中 S≥4 的 {st.solid} 个
          </div>

          <div className="v4kpis" style={{ marginTop: 12 }}>
            <div className="v4kpi"><div className="v">{target.attempt + 1}</div><div className="l">第几次考</div></div>
            <div className="v4kpi"><div className="v">{GATE_PASS}</div><div className="l">总分线</div></div>
            <div className="v4kpi"><div className="v">{SPELL_PASS}</div><div className="l">拼写线</div></div>
            <div className="v4kpi"><div className="v">30</div><div className="l">题量</div></div>
          </div>

          <div className="v4note" style={{ marginTop: 12 }}>
            卷子里的词是本单元最该考的那些：先钉子词，再逾期久的，最后 S 小的。
            答错直接给答案、不重做——这场是量你，不是教你。
            <div style={{ marginTop: 6 }}>总分到 {GATE_PASS} 且拼写到 {SPELL_PASS} 才算过。不过就进 3 天补丁期，补完再考。</div>
          </div>

          <button className="btn" style={{ marginTop: 14 }} onClick={start}>开始 · {Math.min(30, st.total)} 题</button>
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => nav('/')}>今天先不考</button>
        </div>
      </Shell>
    )
  }

  /* ── 结算 ── */
  if (phase === 'wrap') {
    const r = gradePaper(recs)
    const wrong = recs.filter(x => !x.correct || x.peek)
    return (
      <Shell title="闸门结果" noNav>
        <div className={'card pad v4wrap' + (r.pass ? ' ok' : '')}>
          <div className="v4verdict">{r.pass ? '✓ 过关' : '未过关'}</div>
          <div className="v4score">{r.score}<span>分</span></div>
          <div className="sub small" style={{ textAlign: 'center', marginBottom: 14 }}>
            {unitName(target.unit)} · 第 {target.attempt + 1} 次 · {bjShort(day)}
          </div>

          <div className="v4kpis">
            <div className="v4kpi">
              <div className="v" style={{ color: r.score >= GATE_PASS ? 'var(--ok)' : 'var(--bad)' }}>{r.score}</div>
              <div className="l">总分 / {GATE_PASS}</div>
            </div>
            <div className="v4kpi">
              <div className="v" style={{ color: r.spellScore >= SPELL_PASS ? 'var(--ok)' : 'var(--bad)' }}>{r.spellScore}</div>
              <div className="l">拼写 / {SPELL_PASS}</div>
            </div>
            <div className="v4kpi"><div className="v">{r.right}/{r.total - r.peekN}</div><div className="l">首答对</div></div>
            <div className="v4kpi"><div className="v">{r.peekN}</div><div className="l">看答案</div></div>
          </div>

          {!r.pass && (
            <div className="v4note bad" style={{ marginTop: 12 }}>
              <b>{r.score < GATE_PASS ? `总分差 ${GATE_PASS - r.score} 分` : `拼写差 ${SPELL_PASS - r.spellScore} 分`}</b>
              <div style={{ marginTop: 4 }}>
                接下来 3 天只补这个单元的弱词，补完再来。这 3 天闸门先灰着，不用急着刷。
              </div>
            </div>
          )}
          {r.pass && (
            <div className="v4note ok" style={{ marginTop: 12 }}>
              过关了。这批词会退到后排复习，明天开始学后面的单元。
            </div>
          )}

          {wrong.length > 0 && (
            <div className="v4note" style={{ marginTop: 10 }}>
              <b>这次错的 {wrong.length} 个</b>
              <div className="sub small" style={{ marginTop: 4, lineHeight: 1.8 }}>
                {wrong.slice(0, 12).map(w => `${w.word}（${cnOf(w.word)}）`).join('、')}
                {wrong.length > 12 ? ` 等 ${wrong.length} 个` : ''}
              </div>
            </div>
          )}

          <div className="sub small" style={{ textAlign: 'center', marginTop: 10 }}>
            用时 {fmtSec(Math.round(recs.reduce((n, x) => n + x.ms, 0) / 1000))}
          </div>

          <button className="btn" style={{ marginTop: 14 }} onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  /* ── 答题 ── */
  const total = qs.length
  const pct = Math.round((qi / Math.max(1, total)) * 100)

  return (
    <Shell title={`${unitName(unit)} 过关`} back>
      <div className="between" style={{ margin: '0 2px 10px' }}>
        <div className="v4bar" style={{ flex: 1, marginRight: 10 }}><i style={{ width: pct + '%' }} /></div>
        <div className="sub small">{qi + 1} / {total}</div>
      </div>

      <div className="card pad">
        {q?.kind === 'spell' && (
          <div>
            <div className="v4prompt" style={{ textAlign: 'center' }}>
              {showCn ? q.cn : (
                <button className="btn ghost" onClick={() => setShowCn(true)}>点这里看中文</button>
              )}
            </div>
            <div className="v4hint">{q.hint}<span className="sub small"> · {q.len} 个字母</span></div>
            <input className="v4input" value={input} readOnly inputMode="none"
              onChange={e => setInput(e.target.value)} placeholder="在这里拼出来" />
            {verdict === '' ? (
              <LetterKeyboard
                onKey={ch => setInput(v => v + ch)}
                onBackspace={() => setInput(v => v.slice(0, -1))}
                onSubmit={() => {
                  if (!input.trim()) return
                  const ok = judgeWithFirst(input, q.word) || judge(input, q.word)
                  setVerdict(ok ? 'ok' : 'bad')
                  record(ok)
                  setInput('')
                  if (ok) window.setTimeout(() => next(), 380)
                }}
              />
            ) : (
              <div className={'v4note ' + (verdict === 'ok' ? 'ok' : 'bad')} style={{ marginTop: 10 }}>
                {verdict === 'ok' ? '拼对了' : <>正确拼写：<b className="v4ans">{q.word}</b></>}
                <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
              </div>
            )}
          </div>
        )}

        {q?.kind === 'pick' && (
          <div>
            <div className="v4prompt" style={{ textAlign: 'center' }}>{q.cn}</div>
            <div className="v4opts">
              {(q.options || []).map(o => (
                <button key={o.key} className={'v4opt' + (sel === o.key ? ' on' : '')}
                  onClick={() => { if (verdict === '') setSel(o.key) }}>{o.text}</button>
              ))}
            </div>
            {verdict === '' ? (
              <button className="btn" disabled={!sel} onClick={() => {
                const ok = sel === q.answerKey
                setVerdict(ok ? 'ok' : 'bad')
                record(ok)
                if (ok) window.setTimeout(() => next(), 380)
              }}>{sel ? '确定' : '先选一个'}</button>
            ) : (
              <div className={'v4note ' + (verdict === 'ok' ? 'ok' : 'bad')} style={{ marginTop: 10 }}>
                {verdict === 'ok' ? '对了' : <>正确答案：<b>{q.cn}</b></>}
                <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
              </div>
            )}
          </div>
        )}

        {q?.kind === 'sent' && q.tokens && (
          <div>
            <div className="v4prompt">{q.cn}</div>
            <div className="v4slot">
              {picked.map((x, i) => (
                <button key={i} className="v4tok on" onClick={() => {
                  if (verdict !== '') return
                  setPicked(p => p.filter((_, j) => j !== i))
                  setPool(p => [...p, x.idx])
                }}>{x.text}</button>
              ))}
            </div>
            <div className="v4toks">
              {pool.map(idx => (
                <button key={idx} className="v4tok" onClick={() => {
                  if (verdict !== '') return
                  setPicked(p => [...p, { idx, text: q.tokens![idx] }])
                  setPool(p => p.filter(x => x !== idx))
                }}>{q.tokens![idx]}</button>
              ))}
            </div>
            {verdict === '' ? (
              <button className="btn" style={{ marginTop: 12 }} disabled={pool.length > 0}
                onClick={() => {
                  const ok = judgeSentence(picked.map(x => x.text), q.tokens!)
                  setVerdict(ok ? 'ok' : 'bad')
                  record(ok)
                  if (ok) window.setTimeout(() => next(), 400)
                }}>
                {pool.length > 0 ? '还有词块没用完' : '确定'}
              </button>
            ) : (
              <div className={'v4note ' + (verdict === 'ok' ? 'ok' : 'bad')} style={{ marginTop: 10 }}>
                {verdict === 'ok' ? '拼对了' : <>正确句子：<b>{q.en}</b></>}
                <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
              </div>
            )}
          </div>
        )}

        {q?.kind === 'paper' && (
          <div className="v4center">
            <div className="v4prompt">写在听写本上（这题要动笔）</div>
            <div className="v4teachcn">{q.cn}</div>
            <div className="sub small" style={{ marginTop: 6 }}>写完自己核对，别偷看手机</div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => { record(true); next() }}>写对了</button>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => { record(false); next() }}>没写出来</button>
            </div>
          </div>
        )}
      </div>

      {q && q.kind !== 'paper' && verdict === '' && (
        <button className="v4peek" onClick={() => {
          setPeeked(true)
          record(false, true)
          setVerdict('bad')
          void peeked
        }}>
          不会，看答案（不计分）
        </button>
      )}
    </Shell>
  )
}
