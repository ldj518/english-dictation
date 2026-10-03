import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore, judge } from '../lib/store'
import { dueWrongWords, todayStr } from '../lib/storage'
import { playWordText } from '../lib/data'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import LetterKeyboard from '../components/LetterKeyboard'
import type { WrongWord, WrongLogEntry } from '../types'

type Mode = 'list' | 'quiz'
type Filter = 'due' | 'all' | 'log'

export default function Review() {
  const { progress, recordReview, clearWrong } = useStore()
  const nav = useNavigate()
  const [mode, setMode] = useState<Mode>('list')
  const [filter, setFilter] = useState<Filter>('due')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const all = useMemo(() => Object.values(progress.wrong).sort((a, b) => b.count - a.count), [progress.wrong])
  const due = useMemo(() => dueWrongWords(progress), [progress.wrong])
  const log = useMemo(
    () => Object.values(progress.wrongLog || {}).sort((a, b) => b.lastAt - a.lastAt),
    [progress.wrongLog],
  )
  /** 近 7 天错过的词（错次多的优先，最多 20 个）——周末一键测一遍 */
  const weekly = useMemo(
    () => all.filter(w => w.lastAt >= Date.now() - 7 * 86400000).slice(0, 20),
    [all],
  )

  const list = filter === 'due' ? due : filter === 'all' ? all : log
  const selCount = list.filter(w => sel.has(w.word)).length
  const allOn = list.length > 0 && selCount === list.length

  const speak = (w: string) => { void playWordText(w, 0.85) }

  const toggle = (word: string) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(word)) next.delete(word); else next.add(word)
    return next
  })

  const toggleAll = () => setSel(prev => {
    const next = new Set(prev)
    if (allOn) list.forEach(w => next.delete(w.word))
    else list.forEach(w => next.add(w.word))
    return next
  })

  /** 选定要闯关/听写的词：勾选了就用勾选的，否则用当前列表全部 */
  const chosen = () => {
    const picked = list.filter(w => sel.has(w.word))
    const pool = picked.length ? picked : list
    return pool.map(w => ({ word: w.word, cn: w.cn }))
  }

  const writeWords = (words: { word: string; cn: string }[]) => {
    if (!words.length) return false
    try { sessionStorage.setItem('custom-words', JSON.stringify(words)) } catch { return false }
    return true
  }

  /** 错词五关闯关（v3.6）：见词听音 → 听音选义 → 跟读 → 首字母拼写 → 听写，每关可跳过 */
  const startFlow = () => {
    if (!writeWords(chosen())) return
    nav('/learn/wcustom')
  }

  /** 勾选的词 → 自定义错词卷（/d/custom 从 sessionStorage 取词单）：只想直接听写时用 */
  const startCustomDictation = () => {
    if (!writeWords(chosen())) return
    nav('/d/custom')
  }

  /** 本周错词一键成卷：近 7 天错过的词（≤20）→ 自定义错词卷 */
  const startWeeklyQuiz = () => {
    if (!weekly.length) return
    if (!writeWords(weekly.map(w => ({ word: w.word, cn: w.cn })))) return
    nav('/d/custom')
  }

  if (mode === 'quiz') {
    return <Quiz words={filter === 'all' ? all : due} onExit={() => setMode('list')} />
  }

  return (
    <Shell title="错词本" sub={`${all.length} 个待巩固 · 历史 ${log.length} 个`}>
      <div className="card pad" style={{ background: 'linear-gradient(180deg,#fffdf5,#fff)', borderColor: '#f0d69a' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          📖 错词不是失败，是地图
        </div>
        <div className="sub small mt">
          答错的词会自动进来。按遗忘曲线（1→2→4→7→15→30 天）安排复习，
          连续答对到满级就自动毕业——毕业词进「总历史」永远查得到，随时能重听。
        </div>
        <div className="mt" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={{ background: 'var(--blue)' }} onClick={startFlow} disabled={!list.length}>
            🎯 五关闯关{list.length ? ` (${selCount > 0 ? selCount : list.length} 词)` : ''}
          </button>
          <button className="btn gold sm" onClick={() => setMode('quiz')} disabled={!list.length || filter === 'log'}>
            ▶ 直接听写复习{list.length ? ` (${list.length})` : ''}
          </button>
          {weekly.length > 0 && filter !== 'log' && (
            <button className="btn sm" style={{ background: '#7048e8', color: '#fff' }} onClick={startWeeklyQuiz}>
              📋 本周错词测一次 ({weekly.length})
            </button>
          )}
          {all.length > 0 && (
            <button className="btn ghost sm" onClick={() => { if (confirm('确定清空错词本？此操作不可恢复。（总历史记录会保留）')) clearWrong() }}>
              清空
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={filter === 'due' ? 'on' : ''} onClick={() => setFilter('due')}>
          今天该复习 ({due.length})
        </button>
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          全部错词 ({all.length})
        </button>
        <button className={filter === 'log' ? 'on' : ''} onClick={() => setFilter('log')}>
          总历史 ({log.length})
        </button>
      </div>

      {filter === 'log' && list.length > 0 && (
        <div className="sub small" style={{ margin: '10px 2px' }}>
          这里是孩子错过的每一个词的全周期战绩：错几次、对几次、有没有毕业。
          词永远不会从这里消失；在历史里重听，答错会重新回到错词本安排复习。
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <div className="i">{filter === 'log' ? '📜' : '🎉'}</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
            {filter === 'due' ? '今天没有要复习的词' : filter === 'all' ? '错词本是空的' : '还没有历史记录'}
          </div>
          <div className="mt">{filter === 'log' ? '答错的词会自动记进总历史' : '保持下去，做错的题正在变成会的题'}</div>
        </div>
      ) : (
        <>
          <div className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" onClick={toggleAll}>{allOn ? '取消全选' : '✅ 全选'}</button>
            {selCount > 0 && (
              <button className="btn ghost sm" onClick={() => setSel(new Set())}>清空勾选</button>
            )}
            <span className="sub small" style={{ flex: 1, textAlign: 'right' }}>
              已选 {selCount}/{list.length}
            </span>
            <button className="btn gold sm" onClick={startCustomDictation} disabled={!selCount}>
              ▶ 听写所选{selCount ? ` (${selCount})` : ''}
            </button>
          </div>
          <div className="card">
            {filter === 'log'
              ? log.map(w => (
                <LogRow key={w.word} w={w} active={!!progress.wrong[w.word]}
                  checked={sel.has(w.word)} onToggle={() => toggle(w.word)} onSpeak={() => speak(w.word)} />
              ))
              : (filter === 'due' ? due : all).map(w => (
                <WrongRow key={w.word} w={w} checked={sel.has(w.word)} onToggle={() => toggle(w.word)} onSpeak={() => speak(w.word)} />
              ))}
          </div>
        </>
      )}
    </Shell>
  )
}

function WrongRow({ w, checked, onToggle, onSpeak }: { w: WrongWord; checked: boolean; onToggle: () => void; onSpeak: () => void }) {
  const stages = ['1天', '2天', '4天', '7天', '15天', '30天']
  const overdue = w.dueAt <= Date.now()
  const days = Math.ceil((w.dueAt - Date.now()) / 86400000)

  return (
    <div className="pad" style={{ borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 20, height: 20, flexShrink: 0 }} aria-label="选择" />
      <button onClick={onSpeak} style={{ fontSize: 20, width: 36, textAlign: 'center' }} aria-label="朗读">🔊</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{w.word}</div>
        <div className="sub small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {w.cn}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span className="pill p-bad">错 {w.count} 次</span>
        {!!w.okCount && <span className="pill p-ok" style={{ marginLeft: 4 }}>对 {w.okCount}</span>}
        <div className="sub small" style={{ marginTop: 4 }}>
          {overdue ? <span style={{ color: 'var(--gold)', fontWeight: 700 }}>该复习了</span>
            : `${days} 天后`}
          {' · '}{stages[Math.min(w.stage, 5)]}
        </div>
      </div>
    </div>
  )
}

/** 总历史行（v3.6）：只展示战绩，词永不消失 */
function LogRow({ w, active, checked, onToggle, onSpeak }: {
  w: WrongLogEntry; active: boolean; checked: boolean; onToggle: () => void; onSpeak: () => void
}) {
  return (
    <div className="pad" style={{ borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 20, height: 20, flexShrink: 0 }} aria-label="选择" />
      <button onClick={onSpeak} style={{ fontSize: 20, width: 36, textAlign: 'center' }} aria-label="朗读">🔊</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {w.word}
          {w.gradAt && (
            <span className="pill p-ok" style={{ marginLeft: 6, fontSize: 11 }}>🎓 已毕业</span>
          )}
          {!w.gradAt && active && <span className="sub small" style={{ marginLeft: 6 }}>在错词本</span>}
        </div>
        <div className="sub small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {w.cn}
        </div>
      </div>
      <div style={{ textAlign: 'right', lineHeight: 1.5 }}>
        <div>
          <span className="pill p-bad">错 {w.bad}</span>
          <span className="pill p-ok" style={{ marginLeft: 4 }}>对 {w.ok}</span>
        </div>
        <div className="sub small" style={{ marginTop: 4 }}>
          最近：{w.lastOk === 'ok' ? '✓ 答对' : '✗ 答错'}
        </div>
      </div>
    </div>
  )
}

/** 复习测验（顺序每次进入都打乱，防止记顺序） */
function Quiz({ words, onExit }: { words: WrongWord[]; onExit: () => void }) {
  const { recordReview, progress, profile } = useStore()
  const kb = progress.settings.kbBuiltIn !== false
  const shuffled = useMemo(() => {
    if (!progress.settings.shuffle || words.length < 2) return words
    // 复习用「进入时刻」当种子，每次进来顺序都不同
    return seededShuffle(words, makeSeed(todayStr(), profile.id, 'review', String(Date.now())))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [i, setI] = useState(0)
  const [input, setInput] = useState('')
  const [st, setSt] = useState<'ask' | 'ok' | 'bad'>('ask')
  const [stat, setStat] = useState({ ok: 0, bad: 0 })
  const cur = shuffled[i]

  const play = () => { void playWordText(cur.word, 0.85) }

  const submit = () => {
    const ok = judge(input, cur.word)
    recordReview(cur.word, cur.cn, ok)
    setSt(ok ? 'ok' : 'bad')
    setStat(s => ({ ok: s.ok + (ok ? 1 : 0), bad: s.bad + (ok ? 0 : 1) }))
  }

  const next = () => {
    if (i + 1 >= shuffled.length) { onExit(); return }
    setI(i + 1); setInput(''); setSt('ask')
    setTimeout(() => { void playWordText(shuffled[i + 1].word, 0.85) }, 200)
  }

  if (!cur) { onExit(); return null }

  return (
    <Shell title="错词复习" back sub={`${i + 1}/${words.length}`} noNav>
      <div className="qbar">
        <div className="qhead">
          <span>复习 <b>{i + 1}</b> / {words.length}</span>
          <span>✓{stat.ok} ✗{stat.bad}</span>
        </div>
        <div className="progressbar"><i style={{ width: `${((i + 1) / words.length) * 100}%` }} /></div>
      </div>

      <div className="playbox">
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>听发音，写出这个单词</div>
        <button className="bigplay" onClick={play}>🔊</button>
        <div className="cn" style={{ marginTop: 6 }}>{cur.cn}</div>
        <div className="hint">中文意思已给出，点 🔊 反复听</div>
      </div>

      <div className="answerrow">
        <input
          autoFocus
          className={st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : ''}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); st === 'ask' ? submit() : next() } }}
          placeholder="写英文…"
          inputMode={kb ? 'none' : 'text'}
          spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          disabled={st !== 'ask'}
        />
        {st === 'ask'
          ? <button className="sub btn" onClick={submit} disabled={!input.trim()}>确认</button>
          : <button className="sub btn ok" onClick={next}>下一个</button>}
      </div>

      {kb && (
        <LetterKeyboard
          disabled={st !== 'ask'}
          onKey={c => setInput(v => v + c)}
          onBackspace={() => setInput(v => v.slice(0, -1))}
          onSubmit={() => (st === 'ask' ? submit() : next())}
        />
      )}

      {st !== 'ask' && (
        <div className={'verdict ' + (st === 'ok' ? 'ok' : 'bad')}>
          {st === 'ok'
            ? <>✓ 答对，复习进度 +1</>
            : <>✗ 正确答案<span className="ans">{cur.word}</span></>}
        </div>
      )}

      <div className="center mt">
        <button className="btn ghost sm" onClick={onExit}>结束复习</button>
      </div>
    </Shell>
  )
}
