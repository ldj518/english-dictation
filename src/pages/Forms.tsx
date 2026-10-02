import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { playWordText } from '../lib/data'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import { todayStr } from '../lib/storage'
import {
  allFormItems, makeFormQ, judgeForm, KIND_LABEL,
  type FormKind, type FormQ,
} from '../lib/wordforms'
import type { AnswerRecord, Track } from '../types'

/**
 * 词形变换（v3.1）：/forms/:kind
 *
 * 对标初中卷面「用所给单词的适当形式填空」——单词都会背、卷面照样丢分的那一环。
 * - 题源是手工句库（语境真实），答案由规则引擎推导，判定后展示规则说明
 * - 屏幕只给句子 + 括号原词，不给「要变成什么形式」——和考试一样自己判断
 * - 记账 mode='forms'，skipBest：不占听写最好成绩
 * - 同一天同一人同一题型顺序固定（同种子），防背顺序
 */

type KindUi = 'all' | FormKind
const KIND_TABS: [KindUi, string][] = [
  ['all', '综合'], ['s-3rd', '三单'], ['past', '过去式'], ['ing', 'ing'], ['plural', '复数'],
]
const SESSION_LEN = 15

export default function Forms() {
  const { kind: kindParam } = useParams()
  const nav = useNavigate()
  const { progress, recordAnswer, submitSession, profile } = useStore()
  const [kind, setKind] = useState<KindUi>((KIND_TABS.some(([k]) => k === kindParam) ? kindParam : 'all') as KindUi)
  const [phase, setPhase] = useState<'intro' | 'ask' | 'done'>('intro')
  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [st, setSt] = useState<'ask' | 'ok' | 'bad'>('ask')
  const [answers, setAnswers] = useState<{ q: FormQ; input: string }[]>([])
  const startedAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)

  const pool = useMemo(() => {
    const items = allFormItems()
    const out: { q: FormQ }[] = []
    for (const it of items) {
      for (const k of it.kinds) {
        if (kind !== 'all' && k !== kind) continue
        const q = makeFormQ(it, k)
        if (q) out.push({ q })
      }
    }
    // 综合卷把同词的多种形态拆开排，避免连续考同一个词
    const shuffled = seededShuffle(out, makeSeed(todayStr(), profile.id, 'forms:' + kind, ''))
    return shuffled.slice(0, SESSION_LEN)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const list = pool.map(p => p.q)
  const cur = list[idx]

  const submit = () => {
    if (!cur || !input.trim()) return
    const ok = judgeForm(input, cur)
    if (ok) recordAnswer(cur.word, cur.cn, input, true)
    setSt(ok ? 'ok' : 'bad')
    setAnswers(a => [...a, { q: cur, input }])
    void playWordText(cur.word, 0.9)
  }

  const next = () => {
    if (idx + 1 >= list.length) { finish(); return }
    setIdx(idx + 1); setInput(''); setSt('ask')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const finish = () => {
    const secs = Math.round((Date.now() - startedAt.current) / 1000)
    const right = answers.filter(a => judgeForm(a.input, a.q)).length
    const total = list.length
    const fakeTrack = {
      id: 'forms-' + kind, kind: 'daily' as const, group: 'daily' as const,
      order: 0, label: `词形变换 · ${kind === 'all' ? '综合' : KIND_LABEL[kind]}`,
      file: '', seconds: secs, wordCount: total, sections: [], items: [],
    } as unknown as Track
    submitSession(fakeTrack, answers.map(a => ({
      no: 0, word: a.q.word, cn: a.q.answer, input: a.input, correct: judgeForm(a.input, a.q),
    })), secs, 'forms', { skipBest: true })
    setPhase('done')
    setSt('ask')
    setIdx(0)
    setInput('')
  }

  /* ── 预备页 ── */
  if (phase === 'intro') {
    return (
      <Shell title="词形变换" back sub="适当形式填空 · 卷面必考">
        <div className="card pad" style={{ background: 'linear-gradient(180deg,#f4f8ff,#fff)', borderColor: '#c9dbf5' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📝 单词背了，卷子上还丢分？</div>
          <div className="sub small mt" style={{ lineHeight: 1.8 }}>
            考试考的不是「这个词长什么样」，而是「它在句子里变成了什么样」：
            三单加 s、过去式变 ed、双写、去 e、变 y 为 i……
            这里有真实句子，括号给原词，你写出它的正确形式。
          </div>
        </div>

        <div className="seg" style={{ width: '100%', marginBottom: 14 }}>
          {KIND_TABS.map(([k, t]) => (
            <button key={k} className={kind === k ? 'on' : ''} style={{ flex: 1 }} onClick={() => { setKind(k); setIdx(0) }}>
              {t}
            </button>
          ))}
        </div>

        <div className="card pad">
          <div className="between">
            <span>本卷题量</span>
            <b>{list.length} 题</b>
          </div>
          <div className="sub small" style={{ marginTop: 6, lineHeight: 1.7 }}>
            每题给一句英文（挖了空）和括号里的原词，写出它的正确形式。
            不提示要变什么形式，自己判断——跟考试一样。
          </div>
        </div>

        <button className="btn" style={{ width: '100%', marginTop: 14 }} disabled={!list.length} onClick={() => { setPhase('ask'); startedAt.current = Date.now(); setTimeout(() => inputRef.current?.focus(), 50) }}>
          {list.length ? `▶ 开始（${list.length} 题）` : '这个题型暂时没有题'}
        </button>
      </Shell>
    )
  }

  /* ── 结束页 ── */
  if (phase === 'done') {
    const right = answers.filter(a => judgeForm(a.input, a.q)).length
    const total = answers.length
    const score = total ? Math.round((right / total) * 100) : 0
    const wrongList = answers.filter(a => !judgeForm(a.input, a.q))
    return (
      <Shell title="词形变换成绩" back>
        <div className="hero">
          <div className="lv">📝 {kind === 'all' ? '综合' : KIND_LABEL[kind]}</div>
          <div className="nm">{score} 分</div>
          <div className="meta" style={{ marginTop: 10 }}>
            <div><b>{right}</b>对</div>
            <div><b>{total - right}</b>错</div>
            <div><b>{total}</b>总题</div>
          </div>
        </div>

        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>答案与规则</div>
          {answers.map((a, i) => {
            const ok = judgeForm(a.input, a.q)
            return (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < answers.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <div className="sub small">{a.q.sentence.replace('___', '＿＿＿')}</div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: ok ? 'var(--green, #3b6d11)' : 'var(--red, #a32d2d)' }}>
                  {ok ? '✓' : '✗'} {a.q.word} → {a.q.answer}
                  {!ok && a.input.trim() && <span className="sub small" style={{ fontWeight: 400 }}>（你写的：{a.input.trim()}）</span>}
                </div>
                <div className="sub small" style={{ marginTop: 2 }}>{a.q.ruleNote} · {a.q.sentenceCn}</div>
              </div>
            )
          })}
        </div>

        <div className="row" style={{ gap: 10, marginTop: 14, paddingBottom: 40 }}>
          <button className="btn ghost" onClick={() => { setAnswers([]); setPhase('intro') }}>换一卷</button>
          <button className="btn" onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  /* ── 答题页 ── */
  if (!cur) { setPhase('intro'); return null }
  const parts = cur.sentence.split('___')

  return (
    <Shell title="词形变换" back sub={`${idx + 1} / ${list.length}`}>
      <div className="qbar">
        <div className="progressbar"><i style={{ width: `${((idx + 1) / list.length) * 100}%` }} /></div>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <div style={{ fontSize: 17, lineHeight: 2, fontWeight: 600 }}>
          {parts[0]}
          <span style={{
            display: 'inline-block', minWidth: 90, borderBottom: '2px solid var(--blue, #2f5fd0)',
            color: st === 'ask' ? 'transparent' : st === 'ok' ? '#3b6d11' : '#a32d2d',
            textAlign: 'center', margin: '0 4px', userSelect: 'none',
          }}>
            {st === 'ask' ? '＿＿＿' : cur.answer}
          </span>
          {parts.slice(1).join('___')}
        </div>
        <div style={{ marginTop: 10, fontSize: 15 }}>
          <span style={{ color: 'var(--blue, #2f5fd0)', fontWeight: 700 }}>({cur.word})</span>
        </div>
        <div className="sub small" style={{ marginTop: 6 }}>{cur.sentenceCn}</div>
      </div>

      <div className="answerrow">
        <input
          ref={inputRef}
          autoFocus
          className={st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : ''}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); st === 'ask' ? submit() : next() } }}
          placeholder="写出正确形式…"
          inputMode={progress.settings.kbBuiltIn !== false ? 'none' : 'text'}
          spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          disabled={st !== 'ask'}
        />
        {st === 'ask'
          ? <button className="sub btn" onClick={submit} disabled={!input.trim()}>确认</button>
          : <button className="sub btn ok" onClick={next}>下一个</button>}
      </div>

      {st !== 'ask' && (
        <div className={'verdict ' + (st === 'ok' ? 'ok' : 'bad')}>
          {st === 'ok'
            ? <>✓ {cur.word} → {cur.answer}</>
            : <>✗ 正确形式 <span className="ans">{cur.answer}</span> · {cur.ruleNote}</>}
        </div>
      )}

      <div className="center mt" style={{ paddingBottom: 40 }}>
        <button className="btn ghost sm" onClick={finish}>提前结束</button>
      </div>
    </Shell>
  )
}
