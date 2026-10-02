import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import PinGate from '../components/PinGate'
import AudioGate from '../components/AudioGate'
import LetterKeyboard from '../components/LetterKeyboard'
import { useStore, judge } from '../lib/store'
import { judgeWithFirst } from '../lib/storage'
import { UNIT_WORDS, WORD_MAP, WORDS, playWordText } from '../lib/data'
import { buildCnOptions } from '../lib/translate'
import { seededShuffle, makeSeed, newSalt } from '../lib/shuffle'
import type { AnswerRecord, Track } from '../types'

/**
 * 单元过关测试（v3.4）：/test/:uid（unit01..unit07）
 *
 * 一张卷三段连答，对标考试的「词汇运用」综合卷：
 *   第一段 听写 10 题（听音写词） + 第二段 首字母填空 5 题 + 第三段 英译汉 6 选 1 5 题
 * 每题 5 分共 100 分，≥85 分判「过关」，Home 单元卡亮章。
 *
 * 设计要点：
 * - 整卷不给逐题反馈（与期末模考同规），交卷才出分——过关测试要的是「考」不是「练」
 * - 每次进卷重新洗牌（会话种子），词序与段落分配都重排，防背位置
 * - 上报 mode='unittest' + skipBest：不占单元听写最好成绩，只进 attempts/history
 * - 过关记 progress.passed[uid]，跨设备走 mergeProgress（分数高者赢）
 * - 防泄题与全站同规：卷面只有听音/中文/首字母/选项，绝不出现完整词形
 */

const PASS_LINE = 85
const D_COUNT = 10
const S_COUNT = 5
const T_COUNT = 5

interface SegItem { word: string; cn: string }

export default function UnitTest() {
  // 兼容两种路由参数名：正式路由是 /test/:uid，冒烟测试的通用壳是 /:id
  const { uid: uidParam, id: idParam } = useParams()
  const uid = uidParam || idParam || ''
  const nav = useNavigate()
  const { progress, submitSession, passUnit, profile } = useStore()
  const kb = progress.settings.kbBuiltIn !== false

  // 每次进卷（或重测）换一个会话种子
  const [runSalt, setRunSalt] = useState(() => newSalt())
  const [started, setStarted] = useState(false)
  const startedAt = useRef(Date.now())

  // 段落词单：同一 runSalt 内稳定（听写 10 / 首字母 5 / 六选一 5）
  const { allItems, dItems, sItems, tItems } = useMemo(() => {
    const pool = (UNIT_WORDS[uid] || [])
      .map(w => WORD_MAP[w])
      .filter((w): w is NonNullable<typeof w> => !!w && !!w.cn)
      .map(w => ({ word: w.word, cn: w.cn }))
    const sh = seededShuffle(pool, makeSeed(runSalt, profile.id, `pass-${uid}`))
    return {
      allItems: sh,
      dItems: sh.slice(0, D_COUNT),
      sItems: sh.slice(D_COUNT, D_COUNT + S_COUNT),
      tItems: sh.slice(D_COUNT + S_COUNT, D_COUNT + S_COUNT + T_COUNT),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, runSalt])

  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [result, setResult] = useState<{ score: number; right: number; total: number; passed: boolean; seconds: number } | null>(null)

  // 三段各自的游标
  const [dIdx, setDIdx] = useState(0)
  const [sIdx, setSIdx] = useState(0)
  const [tIdx, setTIdx] = useState(0)
  const [input, setInput] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const totalQ = D_COUNT + S_COUNT + T_COUNT
  const doneCount = answers.length
  const pct = Math.round((doneCount / totalQ) * 100)

  // 听写段：每题自动读一遍（开始门已过，手势链成立）
  useEffect(() => {
    if (started && dIdx < dItems.length) {
      void playWordText(dItems[dIdx].word)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, dIdx])

  // 首字母段自动聚焦
  useEffect(() => {
    if (started) setTimeout(() => inputRef.current?.focus(), 80)
  }, [sIdx, started])

  /* ── 第一段：听写 ── */
  const submitDict = () => {
    const cur = dItems[dIdx]
    if (!cur || !input.trim()) return
    setAnswers(a => [...a, { no: a.length + 1, word: cur.word, cn: cur.cn, input, correct: judge(input, cur.word) }])
    setInput('')
    setDIdx(i => i + 1)
  }

  /* ── 第二段：首字母 ── */
  const submitSpell = () => {
    const cur = sItems[sIdx]
    if (!cur || !input.trim()) return
    // 屏幕已显示首字母，孩子只补后面的字母也算对（补全式判分，与 Spell 页同规）
    setAnswers(a => [...a, { no: a.length + 1, word: cur.word, cn: cur.cn, input, correct: judgeWithFirst(input, cur.word) }])
    setInput('')
    setSIdx(i => i + 1)
  }

  /* ── 第三段：英译汉 6 选 1 ── */
  const trans = tIdx < tItems.length ? tItems[tIdx] : null
  const tOptions = useMemo(() => {
    if (!trans) return []
    return buildCnOptions(
      allItems, trans.word,
      makeSeed(runSalt, profile.id, `pass-${uid}-t${tIdx}`),
      WORDS.map(w => ({ word: w.word, cn: w.cn })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trans?.word, allItems, runSalt])

  const pickTranslate = (cn: string, correct: boolean) => {
    const cur = tItems[tIdx]
    if (!cur || picked) return
    setPicked(cn)
    // 最后一段的最后一题要直接交卷：闭包里的 answers 少当前这条，
    // 所以在这里就把完整 records 组出来传下去，不依赖异步 state
    const rec: AnswerRecord = { no: answers.length + 1, word: cur.word, cn: cur.cn, input: cn, correct }
    const nextRecords = [...answers, rec]
    setAnswers(nextRecords)
    setTimeout(() => {
      setPicked(null)
      if (tIdx + 1 >= tItems.length) finishWith(nextRecords)
      else setTIdx(i => i + 1)
    }, 350)
  }

  /** 交卷：records 由调用方给全（含最后一条），避免闭包读到旧 answers */
  const finishWith = (records: AnswerRecord[]) => {
    const total = records.length
    const right = records.filter(r => r.correct).length
    const score = total ? Math.round((right / total) * 100) : 0
    const passed = score >= PASS_LINE
    const sec = Math.round((Date.now() - startedAt.current) / 1000)
    const track: Track = {
      id: `pass-${uid}`, kind: 'unit', group: 'unit', order: 0,
      label: `${uid.replace('unit', 'Unit ')} 过关测试`,
      file: '', seconds: 0, wordCount: total, sections: [], items: [],
    }
    submitSession(track, records, sec, 'unittest', { skipBest: true })
    if (passed) passUnit(uid, score)
    setResult({ score, right, total, passed, seconds: sec })
  }

  const retry = () => {
    setAnswers([]); setDIdx(0); setSIdx(0); setTIdx(0)
    setInput(''); setPicked(null); setResult(null)
    setRunSalt(newSalt())
    startedAt.current = Date.now()
    window.scrollTo({ top: 0 })
  }

  const unitLabel = uid.replace('unit', 'Unit ')

  /* ── 词源不存在 ── */
  if (!UNIT_WORDS[uid]) {
    return (
      <Shell title="未找到" back>
        <div className="empty"><div className="i">🤔</div><div>没有这个单元的过关测试</div></div>
      </Shell>
    )
  }

  /* ── 结果页 ── */
  if (result) {
    const wrongs = answers.filter(a => !a.correct)
    return (
      <Shell title="过关测试结果" back noNav>
        <div className="card">
          <div className="scorebig">
            <div className="emoji">{result.passed ? '🏅' : result.score >= 70 ? '👍' : '📖'}</div>
            <div className="num">{result.score}<span style={{ fontSize: 26 }}>分</span></div>
            <div className="lab">{result.passed ? '🎉 过关！这个单元拿下了' : `还差 ${PASS_LINE - result.score} 分过关，错词练熟再来`}</div>
            <div className="lab" style={{ marginTop: 8 }}>
              答对 <b style={{ color: 'var(--ok)' }}>{result.right}</b> / {result.total} 题
              {' · '}用时 {result.seconds >= 60 ? `${Math.floor(result.seconds / 60)}分${result.seconds % 60}秒` : `${result.seconds}秒`}
            </div>
            <div className="lab sub small" style={{ marginTop: 6 }}>
              过关线 {PASS_LINE} 分 · 过关成绩单独记，不影响单元听写最好分
            </div>
          </div>
        </div>

        {wrongs.length > 0 && (
          <div className="card pad" style={{ borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>📌 本次错了 {wrongs.length} 题</div>
            <div className="sub small" style={{ lineHeight: 1.7 }}>
              已自动进错词本，复习队列会安排回炉。练熟后点「再测一次」就能再冲过关。
            </div>
          </div>
        )}

        {/* 防泄题：完整词形明细锁家长解锁码 */}
        <PinGate title="错题明细需家长解锁">
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
          <button className="btn ghost" onClick={retry}>🔁 再测一次</button>
          <button className="btn" onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  /* ── 开始门 ── */
  if (!started) {
    return (
      <Shell title={`${unitLabel} 过关测试`} back>
        <div className="card pad" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>📋 卷面说明</div>
          <div className="sub" style={{ lineHeight: 2 }}>
            共 20 题 · 每题 5 分 · {PASS_LINE} 分过关<br />
            第一段：听音写词 10 题<br />
            第二段：看中文和首字母写词 5 题<br />
            第三段：选中文意思 5 题<br />
            <span style={{ color: '#b45309' }}>整卷不给提示，答完才出分——这就是一场小考试。</span>
          </div>
        </div>
        <AudioGate
          title="过关测试，准备好了吗？"
          tip="点开始后自动读题。第一段是听写，注意听。"
          onStart={() => { startedAt.current = Date.now(); setStarted(true) }}
        />
      </Shell>
    )
  }

  const dictating = dIdx < dItems.length
  const spelling = !dictating && sIdx < sItems.length
  const segLabel = dictating ? '第一段 · 听音写词' : spelling ? '第二段 · 首字母填空' : '第三段 · 选出意思'
  const cur = dictating ? dItems[dIdx] : null
  const spell = spelling ? sItems[sIdx] : null

  /* ── 听写题 ── */
  if (cur) {
    return (
      <Shell title={`${unitLabel} 过关测试`} back sub={`${doneCount + 1}/${totalQ}`} noNav>
        <div className="qbar">
          <div className="qhead">
            <span>{segLabel} <b>{dIdx + 1}</b> / {dItems.length}</span>
            <span>已完成 {doneCount} / {totalQ}</span>
          </div>
          <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
        </div>
        <div className="playbox" style={{ padding: '30px 18px' }}>
          <div style={{ fontSize: 13, color: 'var(--sub)' }}>听，把单词写下来</div>
          <button className="bigplay" style={{ margin: '16px auto' }}
            onClick={() => void playWordText(cur.word)} aria-label="再听一遍">🔊</button>
          <div className="center sub small">没听清可以再点一次</div>
        </div>
        <div className="answerrow">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitDict() } }}
            placeholder="在这里写英文…"
            inputMode={kb ? 'none' : 'text'}
            spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          />
          <button className="sub btn" onClick={submitDict} disabled={!input.trim()}>确认</button>
        </div>
        {kb && (
          <LetterKeyboard
            onKey={c => setInput(v => v + c)}
            onBackspace={() => setInput(v => v.slice(0, -1))}
            onSubmit={submitDict}
          />
        )}
      </Shell>
    )
  }

  /* ── 首字母题 ── */
  if (spell) {
    const hint = spell.word[0] + ' ' + spell.word.slice(1).split('').map(() => '_').join(' ')
    return (
      <Shell title={`${unitLabel} 过关测试`} back sub={`${doneCount + 1}/${totalQ}`} noNav>
        <div className="qbar">
          <div className="qhead">
            <span>{segLabel} <b>{sIdx + 1}</b> / {sItems.length}</span>
            <span>已完成 {doneCount} / {totalQ}</span>
          </div>
          <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
        </div>
        <div className="playbox" style={{ padding: '26px 18px' }}>
          <div style={{ fontSize: 13, color: 'var(--sub)' }}>根据意思和首字母，写出这个单词</div>
          <div className="cn" style={{ fontSize: 22, fontWeight: 700, margin: '14px 0 18px' }}>{spell.cn}</div>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            fontSize: spell.word.length > 10 ? 24 : 30, fontWeight: 800, letterSpacing: 3,
            color: 'var(--ink)', wordBreak: 'break-all', lineHeight: 1.5,
          }}>{hint}</div>
        </div>
        <div className="answerrow">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitSpell() } }}
            placeholder="在这里写英文…"
            inputMode={kb ? 'none' : 'text'}
            spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          />
          <button className="sub btn" onClick={submitSpell} disabled={!input.trim()}>确认</button>
        </div>
        {kb && (
          <LetterKeyboard
            onKey={c => setInput(v => v + c)}
            onBackspace={() => setInput(v => v.slice(0, -1))}
            onSubmit={submitSpell}
          />
        )}
      </Shell>
    )
  }

  /* ── 英译汉 6 选 1 ── */
  if (trans) {
    return (
      <Shell title={`${unitLabel} 过关测试`} back sub={`${doneCount + 1}/${totalQ}`} noNav>
        <div className="qbar">
          <div className="qhead">
            <span>{segLabel} <b>{tIdx + 1}</b> / {tItems.length}</span>
            <span>已完成 {doneCount} / {totalQ}</span>
          </div>
          <div className="progressbar"><i style={{ width: pct + '%' }} /></div>
        </div>
        <div className="playbox">
          <div style={{ fontSize: 13, color: 'var(--sub)' }}>选出这个单词的意思</div>
          <div className="wordBig">{trans.word}</div>
          <button className="bigplay" onClick={() => void playWordText(trans.word)} aria-label="重播">🔊</button>
          <div className="optGrid">
            {tOptions.map(o => {
              const isPicked = picked === o.cn
              const cls = picked
                ? (o.correct ? 'opt right' : isPicked ? 'opt wrong' : 'opt dim')
                : 'opt'
              return (
                <button key={o.cn} className={cls} disabled={!!picked} onClick={() => pickTranslate(o.cn, o.correct)}>
                  {o.cn}
                </button>
              )
            })}
          </div>
        </div>
      </Shell>
    )
  }

  /* ── 理论到不了：最后一段收尾由 pickTranslate 直接触发 ── */
  return (
    <Shell title="交卷中…" back noNav>
      <div className="empty"><div className="i">⏳</div><div>正在统计成绩…</div></div>
    </Shell>
  )
}
