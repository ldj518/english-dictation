/**
 * 家长后台 v5：测验档案 + 词级明细表。
 *
 * 两块都是方案 11.1 里明确要、v4 没做完的：
 *  · 测验档案：每个单元的闸门状态（没触发/待考/第几次过/补丁中）+ 每次得分拆解
 *  · 词级明细：368 行，能筛「钉子词 / 逾期 / 未掌握 / 已毕业」——家长真正看得出问题的地方
 *
 * 数据优先读本地 progress（永远是事实来源），云端只在有网时补历史。
 */

import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { todayStr } from '../lib/storage'
import { bjDiffDays, bjShort } from '../lib/bj'
import { WORDS } from '../lib/data'
import { UNITS, gateStats, patchLeft, attemptOf, unitName, GATE_PASS, SPELL_PASS } from '../lib/gate'
import { LAPSES_NAIL } from '../lib/memory'


type Filter = 'all' | 'nail' | 'weak' | 'due' | 'master'

export default function ParentV5({ studentId }: { studentId: string }) {
  const { progress } = useStore()
  const day = todayStr()
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(40)

  const gates = useMemo(() => UNITS.map(u => {
    const st = gateStats(progress, u, day)
    const runs = (progress.tests || []).filter(t => t.kind === 'gate' && t.unit === u)
    const last = runs[runs.length - 1]
    const passed = runs.find(t => t.pass)
    const patch = patchLeft(progress, u, day)
    const status = passed ? '已通过'
      : patch > 0 ? `补丁中（还剩 ${patch} 天）`
        : last ? '待重考' : (st.learned >= st.total * 0.8 ? '待考' : '未触发')
    return { u, st, runs, last, passed, patch, status, attempt: attemptOf(progress, u) }
  }), [progress, day])

  const rows = useMemo(() => {
    const list = WORDS.map(w => {
      const s = progress.wordState?.[w.word]
      const overdue = s ? bjDiffDays(day, s.due) : -1
      return {
        word: w.word, cn: w.cnFull || w.cn, unit: w.unit || 'extra',
        S: s ? s.S : 0, due: s ? s.due : '—', lapses: s ? s.lapses : 0,
        master: s ? s.master : 0, ok: s ? s.ok : 0, n: s ? s.n : 0, at: s ? s.at : 0,
        overdue,
      }
    })
    const pick = list.filter(r => {
      if (filter === 'nail') return r.lapses >= LAPSES_NAIL
      if (filter === 'weak') return r.master < 2 && r.S < 4
      if (filter === 'due') return r.master < 2 && r.overdue >= 0
      if (filter === 'master') return r.master === 2
      return true
    })
    return pick.sort((a, b) => b.lapses - a.lapses || a.S - b.S || b.overdue - a.overdue)
  }, [progress, filter, day])

  const doneN = (progress.tests || []).filter(t => t.pass).length

  return (
    <>
      {/* ── 测验档案 ── */}
      <div className="card pad pv4" style={{ marginBottom: 14 }}>
        <div className="between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800 }}>测验档案</div>
          <div className="sub small">{doneN} 个单元已过 · 通过线 {GATE_PASS}／拼写 {SPELL_PASS}</div>
        </div>

        <div className="pv4table">
          <div className="pv4tr pv4th p5">
            <div>单元</div><div>状态</div><div>次数</div><div>总分</div><div>拼写</div>
          </div>
          {gates.map(g => (
            <div className="pv4tr p5" key={g.u}>
              <div>{unitName(g.u)}</div>
              <div className={g.passed ? 'ok' : g.patch > 0 ? 'warn' : ''}>{g.status}</div>
              <div>{g.attempt} 次</div>
              <div>{g.last ? g.last.score : '—'}</div>
              <div>{g.last ? g.last.spellScore : '—'}</div>
            </div>
          ))}
        </div>

        {(progress.tests || []).length > 0 && (
          <div className="sub small" style={{ marginTop: 10, lineHeight: 1.9 }}>
            <b>最近几次</b>
            <div>
              {(progress.tests || []).slice(-5).reverse().map(t => (
                `${bjShort(t.dayKey)} ${unitName(t.unit)} ${t.score}分${t.pass ? '✓' : '✗'}`
              )).join(' · ')}
            </div>
          </div>
        )}
      </div>

      {/* ── 词级明细 ── */}
      <div className="card pad pv4" style={{ marginBottom: 14 }}>
        <div className="between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800 }}>词级明细</div>
          <div className="sub small">
            {filter === 'all'
              ? `${WORDS.length} 个词`
              : `筛出 ${rows.length} 个 / 全库 ${WORDS.length}`}
          </div>
        </div>

        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {([['nail', '钉子词'], ['weak', '未掌握'], ['due', '已到期'], ['master', '已毕业'], ['all', '全部']] as [Filter, string][])
            .map(([k, label]) => (
              <button key={k} className={'chip' + (filter === k ? ' on' : '')}
                onClick={() => { setFilter(k); setLimit(40) }}>{label}</button>
            ))}
        </div>

        <div className="pv4table">
          <div className="pv4tr pv4th p5">
            <div>词</div><div>S</div><div>到期</div><div>错</div><div>状态</div>
          </div>
          {rows.slice(0, limit).map(r => (
            <div className="pv4tr p5" key={r.word}>
              <div title={r.cn}>
                <b>{r.word}</b>
                <div className="sub small" style={{ fontSize: 10 }}>{r.cn}</div>
              </div>
              <div>{r.S || '—'}</div>
              <div className={r.overdue > 0 ? 'warn' : ''}>{r.due}{r.overdue > 0 ? `（逾期${r.overdue}）` : ''}</div>
              <div>{r.lapses}</div>
              <div>{r.master === 2 ? '毕业' : r.master === 1 ? '已掌握' : r.n ? '学习中' : '没学过'}</div>
            </div>
          ))}
        </div>

        {rows.length > limit && (
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setLimit(n => n + 60)}>
            再看 {Math.min(60, rows.length - limit)} 个
          </button>
        )}
        {rows.length === 0 && (
          <div className="sub small" style={{ padding: '10px 2px' }}>
            这一类现在没有词。{filter === 'nail' ? '钉子词是错满 4 次的词，没有说明状态不错。' : ''}
          </div>
        )}
      </div>

      {studentId === '' && <div className="sub small">未选定学生</div>}
    </>
  )
}
