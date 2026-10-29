/**
 * 家长看板 · 分型正确率（v7）。
 *
 * 为什么需要这一块：
 *   v6 起每道题都落库了，但家长看到的只有一个总分 62%。这个数字没有
 *   指导意义——「听音选义 78% + 拼写 32%」和「两样都 55%」总分一样，
 *   该做的事完全不同：前者是认得但写不出（练拼写），后者是根本没记过（回去学）。
 *   2026-10-29 上线拼写分级（S≥4 才出拼写），这一块就是它的验收表：
 *   分级有没有把拼写正确率抬起来，只能切开看。
 *
 * 口径（必须和后端一致）：
 *   分母 = 碰过的题，含看答案的；对 = 首答对且没看答案。
 *   看答案的题既算「错」也不从分母里扣——扣了就成了「不会的题不算数」，
 *   孩子连点看答案反而能把正确率刷上去。
 *
 * 只读；后端不可达就显示「读不到」，不假装有数。
 */

import { useEffect, useMemo, useState } from 'react'
import { fetchKindStats, type KindStat } from '../lib/api'

/** 只统计判分题型。flash/teach 是教学卡，从不判分，出现也只是脏数据 */
const META: Record<string, { name: string; hint: string }> = {
  spell: { name: '拼写', hint: '看中文 + 首字母，写出英文' },
  pick: { name: '听音选义', hint: '只给声音，6 选 1 挑中文' },
  sent: { name: '句子拼装', hint: '中文 + 乱序意群块，拼回英文' },
  mean: { name: '句意选择', hint: '整句英文，4 个中文句意选一个' },
  paper: { name: '纸笔默写', hint: '纸上写，之后自己判' },
  unknown: { name: '未分型', hint: '10-29 之前的老记录，没记题型' },
}

const ORDER = ['spell', 'pick', 'sent', 'mean', 'paper', 'unknown']

function secOf(msSum: number, n: number): string {
  if (!n) return '—'
  return (msSum / n / 1000).toFixed(1) + '″'
}

function toneOf(pct: number): string {
  if (pct >= 75) return 'var(--ok)'
  if (pct >= 50) return 'var(--gold)'
  return 'var(--bad)'
}

export default function ParentTypes({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<KindStat[] | null>(null)
  const [days, setDays] = useState(7)

  useEffect(() => {
    let cancel = false
    setRows(null)
    void fetchKindStats(studentId, days)
      .then(r => { if (!cancel) setRows(r) })
      .catch(() => { if (!cancel) setRows([]) })
    return () => { cancel = true }
  }, [studentId, days])

  const list = useMemo(() => {
    const scored = (rows || []).filter(r => r.n > 0 && r.kind !== 'flash' && r.kind !== 'teach')
    const byKey: Record<string, KindStat> = {}
    for (const r of scored) {
      const k = META[r.kind] ? r.kind : 'unknown'
      const prev = byKey[k]
      byKey[k] = prev
        ? {
          kind: k, n: prev.n + r.n, rightN: prev.rightN + r.rightN,
          peekN: prev.peekN + r.peekN, fastN: prev.fastN + r.fastN, msSum: prev.msSum + r.msSum,
        }
        : { ...r, kind: k }
    }
    return ORDER.filter(k => byKey[k]).map(k => {
      const r = byKey[k]
      return { ...r, key: k, ...META[k], pct: r.n ? Math.round((r.rightN / r.n) * 100) : 0 }
    })
  }, [rows])

  const total = list.reduce((s, r) => s + r.n, 0)
  const totalRight = list.reduce((s, r) => s + r.rightN, 0)

  /**
   * 一句话结论。只在两样都有足够样本时才说，样本不足（各 <8 题）就闭嘴——
   * 拿 3 道拼写题断言「他拼不出来」是会误导人的。
   */
  const verdict = useMemo(() => {
    const spell = list.find(r => r.key === 'spell')
    const pick = list.find(r => r.key === 'pick')
    if (!spell || !pick || spell.n < 8 || pick.n < 8) return ''
    const d = pick.pct - spell.pct
    if (d >= 30) return `认得但写不出：选义 ${pick.pct}%，拼写只有 ${spell.pct}%，差了 ${d} 个点。这是他现在最该补的地方——不是记不住词，是记不住字母顺序。`
    if (d >= 12) return `认得比写得出稳一些：选义 ${pick.pct}%、拼写 ${spell.pct}%。差距 ${d} 个点，属于正常范围内偏大，拼写多在纸上练两遍就能补上。`
    if (d <= -8) return `拼写比选义还准（${spell.pct}% vs ${pick.pct}%）。这通常说明选的干扰项太难，或者他其实在背字母顺序、没建立起「音→义」的反射——需要当面确认一次。`
    return `选义 ${pick.pct}%、拼写 ${spell.pct}%，两条线基本齐平。认得和写得出同步，这是好迹象。`
  }, [list])

  if (rows === null) {
    return (
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📊 分型正确率</div>
        <div className="sub small" style={{ marginTop: 6 }}>读取中…</div>
      </div>
    )
  }

  if (!total) {
    return (
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📊 分型正确率</div>
          <RangePick days={days} setDays={setDays} />
        </div>
        <div className="sub small" style={{ marginTop: 6 }}>
          这 {days} 天还没有判分记录。每答一题就会写一条，从下一场开始这里就有数了。
        </div>
      </div>
    )
  }

  return (
    <div className="card pad" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📊 分型正确率</div>
        <RangePick days={days} setDays={setDays} />
      </div>

      <div className="sub small" style={{ marginTop: 6, lineHeight: 1.7 }}>
        这 {days} 天共 {total} 题、对 {totalRight} 题（{Math.round((totalRight / total) * 100)}%）。
        看答案的算错、也不从分母里扣。
      </div>

      <div style={{ marginTop: 12 }}>
        {list.map(r => (
          <div key={r.key} style={{ marginBottom: 11 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</span>
              <span className="sub small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.hint}
              </span>
              <span style={{ fontWeight: 800, fontSize: 14, color: toneOf(r.pct) }}>{r.pct}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{
                flex: 1, height: 8, borderRadius: 4,
                background: 'var(--soft, #f1f3f5)', overflow: 'hidden',
              }}>
                <i style={{
                  display: 'block', height: '100%',
                  width: Math.max(2, r.pct) + '%',
                  background: toneOf(r.pct), borderRadius: 4,
                }} />
              </div>
              <span className="sub small" style={{ flex: '0 0 auto', fontSize: 11.5 }}>
                {r.rightN}/{r.n} 题 · {secOf(r.msSum, r.n)}/题
                {r.peekN > 0 ? ` · 看答案 ${r.peekN}` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>

      {verdict && (
        <div className="v4note" style={{ marginTop: 4, fontSize: 13, lineHeight: 1.75 }}>
          <b>怎么读：</b>{verdict}
        </div>
      )}

      <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
        10-29 起拼写只在「这个词已经连续选对两次」之后才出，所以拼写题会偏少、
        正确率也会浮动——它的意思是「他写得出几个他认得的词」，不是「他拼写差」。
      </div>
    </div>
  )
}

/** 时间窗切换。3 天看当下，7 天看趋势，30 天看整体 */
function RangePick({ days, setDays }: { days: number; setDays: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[3, 7, 30].map(d => (
        <button
          key={d}
          onClick={() => setDays(d)}
          style={{
            padding: '3px 8px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            border: '1px solid ' + (d === days ? 'var(--blue)' : 'var(--line)'),
            background: d === days ? 'var(--blue-soft)' : 'transparent',
            color: d === days ? 'var(--blue)' : 'var(--sub)',
          }}
        >{d}天</button>
      ))}
    </div>
  )
}
