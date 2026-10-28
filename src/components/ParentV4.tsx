/**
 * 家长看板 · v4 区块（今天这一场 / 队列健康 / 逐日账本）。
 *
 * 为什么单独一个组件：Parent.tsx 已经 1100+ 行，再往里塞会没法维护。
 *
 * 数据来源顺序（两条腿，缺一条就退化）：
 *  ① 云端 /api/day（`day_log` + `word_state`）——跨设备、可 SQL 聚合
 *  ② 本地 progress.dayLog / wordState —— 家长在自己手机上打开时云端可能还没同步
 * 两个都读不到就显示「今天还没学」，不假装有数。
 */

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { todayStr } from '../lib/storage'
import { bjAddDays, bjShort, fmtSec, fmtSecCn } from '../lib/bj'
import { fetchDayLog, fetchQueueHealth, type DayRow } from '../lib/api'
import { queueHealth, dueForecast } from '../lib/memory'
import { mergeCfg } from '../lib/plan'

const TIER_CN: Record<string, string> = {
  normal: '正常', settle: '清账', recover: '恢复', restart: '重启', sat: '周六', sun: '周日',
}

export default function ParentV4({ studentId }: { studentId: string }) {
  const { progress } = useStore()
  const [rows, setRows] = useState<DayRow[] | null>(null)
  const [cloud, setCloud] = useState<{ due?: number; weak?: number; nails?: number; master?: number; avg_s?: number; forecast: { day: string; n: number }[] } | null>(null)
  const day = todayStr()

  useEffect(() => {
    let cancel = false
    void fetchDayLog(studentId, bjAddDays(day, -13), day).then(d => { if (!cancel) setRows(d) }).catch(() => { if (!cancel) setRows([]) })
    void fetchQueueHealth(studentId).then(q => {
      if (cancel || !q) return
      setCloud({
        due: q.health.due, weak: q.health.weak, nails: q.health.nails,
        master: q.health.master, avg_s: q.health.avg_s,
        forecast: q.forecast || [],
      })
    }).catch(() => { /* 静默，回退本地 */ })
    return () => { cancel = true }
  }, [studentId, day])

  // 本地兜底：云端没有就用本机 progress 现算
  const local = useMemo(() => {
    const h = queueHealth(progress, day)
    return { h, fc: dueForecast(progress, day, 7), log: progress.dayLog?.[day] }
  }, [progress, day])

  const cfg = mergeCfg(progress.studyCfg)

  // 本地 store 的 DayLog 是驼峰，云端 DayRow 是下划线（D1 列名）。
  // 统一转成 DayRow 再往上用——两套字段名混着读是上一版看板连续打卡恒 0 的老坑。
  const today: DayRow | null = local.log ? {
    day_key: local.log.dayKey, tier: local.log.tier,
    eff_sec: local.log.effSec, idle_sec: local.log.idleSec,
    must_done: local.log.mustDone, must_total: local.log.mustTotal,
    q_n: local.log.qN, right_n: local.log.rightN, peek_n: local.log.peekN,
    done: local.log.done, segs: local.log.segs as DayRow['segs'],
  } : null
  const due = cloud?.due ?? local.h.due
  const weak = cloud?.weak ?? local.h.weak
  const nails = cloud?.nails ?? local.h.nails
  const master = cloud?.master ?? local.h.master
  const avgS = cloud?.avg_s ?? local.h.avgS
  const fc = cloud?.forecast?.length ? cloud.forecast.map(x => ({ day: x.day, n: x.n })) : local.fc
  const fcMax = Math.max(1, ...fc.map(x => x.n))

  const dayRows: DayRow[] = rows && rows.length
    ? rows
    : Object.values(progress.dayLog || {})
      .sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
      .slice(0, 14)
      .map(d => ({
        day_key: d.dayKey, tier: d.tier, eff_sec: d.effSec, idle_sec: d.idleSec,
        must_done: d.mustDone, must_total: d.mustTotal, q_n: d.qN,
        right_n: d.rightN, peek_n: d.peekN, done: d.done, segs: d.segs as DayRow['segs'],
      }))

  const needEff = cfg.minMinWork * 60

  return (
    <>
      {/* ① 今天这一场：细节到每一段 */}
      <div className="card pad pv4" style={{ marginBottom: 14 }}>
        <div className="between" style={{ alignItems: 'baseline' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📅 今天这一场</div>
          <div className="sub small">{bjShort(day)} · {today ? TIER_CN[today.tier] || today.tier : '还没开始'}</div>
        </div>

        {today ? (
          <>
            <div className="pv4kpis">
              <div className="pv4kpi">
                <div className="v" style={{ color: today.eff_sec >= needEff ? 'var(--ok)' : 'var(--bad)' }}>
                  {fmtSec(today.eff_sec)}
                </div>
                <div className="l">有效 / 要求 {fmtSec(needEff)}</div>
              </div>
              <div className="pv4kpi">
                <div className="v" style={{ color: today.must_done >= today.must_total ? 'var(--ok)' : 'var(--gold)' }}>
                  {today.must_done}/{today.must_total}
                </div>
                <div className="l">必做</div>
              </div>
              <div className="pv4kpi">
                <div className="v">{today.q_n ? Math.round((today.right_n / today.q_n) * 100) : 0}%</div>
                <div className="l">首答正确率（{today.right_n}/{today.q_n}）</div>
              </div>
              <div className="pv4kpi">
                <div className="v" style={{ color: today.done ? 'var(--ok)' : 'var(--sub)' }}>
                  {today.done ? '完成' : '未完成'}
                </div>
                <div className="l">双闸门</div>
              </div>
            </div>

            {today.idle_sec > 0 && (
              <div className="sub small" style={{ marginTop: 8 }}>
                挂机 {fmtSecCn(today.idle_sec)}（不算有效学习）。
                有效 {fmtSecCn(today.eff_sec)} + 空闲 {fmtSecCn(today.idle_sec)} = 实际坐在屏前 {fmtSecCn(today.eff_sec + today.idle_sec)}。
              </div>
            )}
            {today.peek_n > 0 && (
              <div className="sub small" style={{ marginTop: 4, color: 'var(--bad)' }}>
                看答案 {today.peek_n} 题（不计分、不进掌握）
                {today.q_n > 0 && today.peek_n / (today.q_n + today.peek_n) > 0.4 ? ' · 超过 40%，当天判不通过' : ''}
              </div>
            )}

            {/* 逐段明细：家长最想知道的「这 30 分钟到底做了什么」 */}
            {today.segs?.length > 0 && (
              <div className="pv4segs">
                {today.segs.filter(s => s.k !== 'wrap').map((s, i) => (
                  <div key={i} className="pv4seg">
                    <span className="pv4segn">{i + 1}</span>
                    <span className="pv4segl">{s.label}</span>
                    <span className="pv4segq">{s.q > 0 ? `${s.q} 题` : '—'}</span>
                    <span className="pv4segr" style={{ color: s.q > 0 && s.right / Math.max(1, s.q) < 0.6 ? 'var(--bad)' : 'var(--ok)' }}>
                      {s.q > 0 ? `${s.right}/${s.q}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="sub small" style={{ marginTop: 10 }}>
            今天还没学。今天该做：到期 <b>{due}</b> 词
            {due > cfg.settleThreshold ? `（积压较多，会先进清账期）` : ''}，新词约 <b>{cfg.newWordCap}</b> 个。
          </div>
        )}
      </div>

      {/* ② 队列健康：到期 / 未掌握 / 钉子 / 毕业 + 未来 7 天 */}
      <div className="card pad pv4" style={{ marginBottom: 14 }}>
        <div className="between" style={{ alignItems: 'baseline' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🧠 记忆队列</div>
          <div className="sub small">平均强度 {avgS} 天</div>
        </div>
        <div className="pv4kpis">
          <div className="pv4kpi"><div className="v" style={{ color: 'var(--bad)' }}>{due}</div><div className="l">今天到期</div></div>
          <div className="pv4kpi"><div className="v">{weak}</div><div className="l">未掌握</div></div>
          <div className="pv4kpi"><div className="v" style={{ color: 'var(--gold)' }}>{nails}</div><div className="l">钉子词（错≥4）</div></div>
          <div className="pv4kpi"><div className="v" style={{ color: 'var(--ok)' }}>{master}</div><div className="l">已毕业</div></div>
        </div>

        <div className="pv4fc">
          {fc.map(x => (
            <div key={x.day} className="pv4fcCol" title={`${x.day} · ${x.n} 个`}>
              <div className="pv4fcBar"><i style={{ height: Math.max(3, Math.round((x.n / fcMax) * 44)) + 'px' }} /></div>
              <div className="pv4fcN">{x.n || ''}</div>
              <div className="pv4fcD">{bjShort(x.day).split('/')[1]}</div>
            </div>
          ))}
        </div>
        <div className="sub small" style={{ marginTop: 4 }}>未来 7 天每天到期的词数</div>
      </div>

      {/* ③ 逐日账本：近 14 天，一天一行 */}
      <div className="card pad pv4" style={{ marginBottom: 14 }}>
        <div className="between" style={{ alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📊 逐日账本</div>
          <div className="sub small">近 {dayRows.length} 天</div>
        </div>
        {dayRows.length === 0 ? (
          <div className="sub small">还没有账本数据。孩子用新的「今天」页面学一场之后才会出现。</div>
        ) : (
          <div className="pv4table">
            <div className="pv4tr pv4th">
              <span>日期</span><span>档位</span><span>有效</span><span>挂机</span><span>必做</span><span>正确率</span>
            </div>
            {dayRows.map(r => {
              const qn = r.q_n || 0
              const acc = qn ? Math.round(((r.right_n || 0) / qn) * 100) : null
              return (
                <div key={r.day_key} className={'pv4tr' + (r.done ? ' ok' : '')}>
                  <span>{bjShort(r.day_key)}</span>
                  <span>{TIER_CN[r.tier] || r.tier || '—'}</span>
                  <span className={r.eff_sec >= needEff ? 'good' : 'bad'}>{Math.round((r.eff_sec || 0) / 60)}′</span>
                  <span className={(r.idle_sec || 0) > 300 ? 'bad' : ''}>{Math.round((r.idle_sec || 0) / 60)}′</span>
                  <span>{r.must_done}/{r.must_total}</span>
                  <span className={acc !== null && acc < 60 ? 'bad' : acc !== null && acc >= 80 ? 'good' : ''}>
                    {acc === null ? '—' : acc + '%'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
          有效时间只算「相邻两次操作间隔 ≤60 秒」的部分——打开放着不管，时间不会涨。
          「必做」是要求做完的题数，做错也算做完，但会记进错词。
        </div>
      </div>
    </>
  )
}
