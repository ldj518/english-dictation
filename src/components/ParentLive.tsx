/**
 * 家长看板 · 今日逐题明细（v6）。
 *
 * 为什么需要这一块：
 *  每日流水线（/today）原来一条题级记录都不写，只有分段耗时（seg_log）和
 *  词级状态（word_state）。孩子中途退出时，家长后台连「今天错了哪几个词」
 *  都看不到——只能看到「学了 2 分钟」。
 *  v6 改成答一题落一条（含没结算的），这块就是那批数据的出口。
 *
 * 只读，不改任何东西；后端不可达就显示「读不到」，不假装有数。
 */

import { useEffect, useMemo, useState } from 'react'
import { bjShort } from '../lib/bj'
import { fetchDayAnswers, type AnswerRow } from '../lib/api'
import { todayStr } from '../lib/storage'

const SHOW = 24

function hhmm(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ParentLive({ studentId }: { studentId: string }) {
  const day = todayStr()
  const [rows, setRows] = useState<AnswerRow[] | null>(null)
  const [openAll, setOpenAll] = useState(false)

  useEffect(() => {
    let cancel = false
    setRows(null)
    void fetchDayAnswers(studentId, day)
      .then(r => { if (!cancel) setRows(r) })
      .catch(() => { if (!cancel) setRows([]) })
    return () => { cancel = true }
  }, [studentId, day])

  const sum = useMemo(() => {
    const list = rows || []
    const n = list.length
    // 看答案的题不算对（和 App 里 rec.correct = !peek && correct 同一口径）
    const right = list.filter(r => r.correct && !r.peek).length
    const peek = list.filter(r => r.peek).length
    const fast = list.filter(r => r.fast).length
    // 「照实算」：看答案的题不算对，但也不从分母里扣——分母是「今天碰过几道题」
    return { n, right, peek, fast, acc: n ? Math.round((right / n) * 100) : 0 }
  }, [rows])

  if (rows === null) {
    return (
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 今天这一场 · 逐题明细</div>
        <div className="sub small" style={{ marginTop: 6 }}>读取中…</div>
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 今天这一场 · 逐题明细</div>
        <div className="sub small" style={{ marginTop: 6 }}>
          今天还没有作答记录。孩子每答一题就会写一条，中途退出也留得住。
        </div>
      </div>
    )
  }

  const list = openAll ? rows : rows.slice(0, SHOW)

  return (
    <div className="card pad" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 今天这一场 · 逐题明细</div>
        <div className="sub small">{bjShort(day)}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, textAlign: 'center' }}>
        {[
          { v: sum.n, k: '作答', c: 'var(--text)' },
          { v: `${sum.acc}%`, k: '正确率', c: sum.acc >= 70 ? 'var(--ok)' : '#e03131' },
          { v: sum.peek, k: '看答案', c: sum.peek > 0 ? '#e8590c' : 'var(--sub)' },
          { v: sum.fast, k: '速答', c: 'var(--sub)' },
        ].map(x => (
          <div key={x.k} style={{ flex: 1, background: 'var(--soft, #f6f7f9)', borderRadius: 10, padding: '8px 4px' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: x.c }}>{x.v}</div>
            <div className="sub small">{x.k}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        {list.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: 8,
            padding: '5px 0', borderBottom: i === list.length - 1 ? 'none' : '1px dashed var(--line, #eee)',
            fontSize: 13,
          }}>
            <span className="sub small" style={{ width: 40, flex: '0 0 40px' }}>{hhmm(r.at)}</span>
            <span style={{ fontWeight: 700, flex: '0 0 auto' }}>{r.word}</span>
            <span className="sub small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.cn}
            </span>
            {/* 必须写 !!：D1 里 peek/fast 是 0/1，{0 && <jsx/>} 会把 0 直接渲染出来 */}
            {!!r.peek && <span className="pill" style={{ background: '#fff4e6', color: '#e8590c', fontSize: 11 }}>看答案</span>}
            {!!r.fast && <span className="pill" style={{ background: '#f1f3f5', color: '#868e96', fontSize: 11 }}>速答</span>}
            <span style={{
              fontWeight: 800, fontSize: 13,
              color: r.correct && !r.peek ? 'var(--ok)' : '#e03131',
            }}>{r.correct && !r.peek ? '✔' : '✘'}</span>
          </div>
        ))}
      </div>

      {rows.length > SHOW && (
        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => setOpenAll(v => !v)}>
          {openAll ? '收起' : `展开全部 ${rows.length} 题`}
        </button>
      )}
      <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
        看答案的题会照实记在「看答案」里，不算对、也不从分母里扣——分母是今天碰过几道题。
        速答指 1.5 秒内答对，多半是凭位置记住的，不当成会了。
      </div>
    </div>
  )
}
