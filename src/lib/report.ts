/**
 * 战报（发给家长微信的那一条）。
 *
 * 方案 11.2 定的六块，缺一块不发：做了什么 / 分数 / 新词逐个 / 到期逐个 /
 * 队列变化 / 一句话结论。结论只给事实，不给形容词（「今天速答 7 题，这 7 个词没有计入掌握」
 * 这种），免得变成一张自夸海报。
 *
 * 图片用 canvas 画成 dataURL 后**渲染成 <img>**，不是直接触发下载——
 * 微信里 a[download] 基本都失败，长按图片保存才是能走通的路。
 */

import type { Progress } from '../types'
import type { DayPlan } from './plan'
import { bjAddDays, bjShort } from './bj'
import { queueHealth } from './memory'
import { fmtSec } from './bj'

export interface ReportRec {
  word: string
  cn?: string
  kind: string
  correct: boolean
  peek?: boolean
  fast?: boolean
  seg: number
}

export interface ReportData {
  dayKey: string
  dayLabel: string
  tier: string
  segN: number
  qN: number
  effSec: number
  idleSec: number
  score: number
  right: number
  noPeekN: number
  peekN: number
  fastN: number
  prevScore: number | null
  newWords: { word: string; cn: string; state: 'ok' | 'bad' | 'peek' }[]
  dueList: { word: string; cn: string; ok: boolean }[]
  dueOk: number
  dueBad: number
  dueTotal: number
  cleared: number
  tomorrowDue: number
  masterTotal: number
  note: string
}

/** 从今天的会话记录拼出六块 */
export function buildReport(p: Progress, plan: DayPlan, recs: ReportRec[], dayKey: string): ReportData {
  const log = p.dayLog?.[dayKey]
  const noPeek = recs.filter(r => !r.peek)
  const right = noPeek.filter(r => r.correct).length
  const score = noPeek.length ? Math.round((right / noPeek.length) * 100) : 0

  const segKind = (i: number) => plan.segs[i]?.k || ''
  const newRecs = recs.filter(r => ['learn', 'recall'].includes(segKind(r.seg)))
  const dueRecs = recs.filter(r => ['review', 'choice', 'spell', 'test'].includes(segKind(r.seg)))

  const newWords = newRecs.map(r => ({
    word: r.word,
    cn: r.cn || '',
    state: (r.peek ? 'peek' : r.correct ? 'ok' : 'bad') as 'ok' | 'bad' | 'peek',
  }))

  const dueList = dueRecs.map(r => ({ word: r.word, cn: r.cn || '', ok: !!r.correct && !r.peek }))
  const dueOk = dueList.filter(x => x.ok).length

  const h = queueHealth(p, dayKey)
  const tomorrow = bjAddDays(dayKey, 1)
  const tomorrowDue = Object.values(p.wordState || {})
    .filter(s => s.master !== 2 && s.due === tomorrow).length

  // 上一次有成绩的那天（跳过「中途退出没结算」的 0）
  const prev = Object.entries(p.dayLog || {})
    .filter(([k, v]) => k < dayKey && v.qN > 0)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))[0]
  const prevLog = prev?.[1]
  const prevScore = prevLog && prevLog.qN
    ? Math.round(((prevLog.rightN || 0) / Math.max(1, prevLog.qN - (prevLog.peekN || 0))) * 100)
    : null

  const fastN = recs.filter(r => r.fast).length
  const parts: string[] = []
  if (fastN > 0) parts.push(`速答 ${fastN} 题（这 ${fastN} 个词只按 1.5 倍涨，没算真会）`)
  if (dueList.length && dueOk < dueList.length) parts.push(`到期词错了 ${dueList.length - dueOk} 个，已回到明天`)
  if (newWords.some(w => w.state === 'bad')) parts.push(`新词 ${newWords.filter(w => w.state === 'bad').length} 个没拼出来`)
  if (log && log.effSec < plan.minMin * 60) {
    parts.push(`有效时间差 ${Math.ceil((plan.minMin * 60 - log.effSec) / 60)} 分钟，今天不算完成`)
  }
  const note = parts.length ? parts.join('；') + '。' : '今天的题都按第一次作答记，没有重做加权。'

  return {
    dayKey, dayLabel: bjShort(dayKey), tier: plan.tierNote,
    segN: plan.segs.filter(s => s.k !== 'wrap').length,
    qN: recs.length, effSec: log?.effSec || 0, idleSec: log?.idleSec || 0,
    score, right, noPeekN: noPeek.length, peekN: recs.length - noPeek.length, fastN,
    prevScore,
    newWords, dueList, dueOk, dueBad: dueList.length - dueOk, dueTotal: plan.dueN,
    cleared: Math.max(0, plan.dueN - (h.due - (h.due > plan.dueN ? plan.dueN : 0))),
    tomorrowDue, masterTotal: h.master,
    note,
  }
}

/** 可直接复制到微信的纯文本（六块） */
export function reportText(d: ReportData): string {
  const L: string[] = []
  L.push(`【今日英语 · ${d.dayLabel}】${d.tier}`)
  L.push('')
  L.push(`① 今天做了什么：${d.segN} 段 / 作答 ${d.qN} 题 / 有效 ${fmtSec(d.effSec)}（空闲 ${fmtSec(d.idleSec)}）`)
  L.push(`② 分数：${d.score} 分（首答对 ${d.right}/${d.noPeekN}${d.peekN ? `，看答案 ${d.peekN} 题不计分` : ''}）${d.prevScore === null ? '' : `，上次 ${d.prevScore} 分`}`)
  if (d.newWords.length) {
    L.push(`③ 新词 ${d.newWords.length} 个：` + d.newWords.map(w => `${w.word}${w.state === 'ok' ? '√' : w.state === 'peek' ? '（看答案）' : '×'}`).join(' '))
  } else {
    L.push('③ 新词：0 个（今天不排新词）')
  }
  if (d.dueList.length) {
    L.push(`④ 到期复习 ${new Set(d.dueList.map(x => x.word)).size} 个：对 ${d.dueOk} 错 ${d.dueBad}`)
    const bad = d.dueList.filter(x => !x.ok)
    if (bad.length) L.push('   错的：' + bad.slice(0, 12).map(x => `${x.word}（${x.cn}）`).join('、'))
  } else {
    L.push('④ 到期复习：0 个')
  }
  L.push(`⑤ 队列：今天清掉 ${d.cleared} 个，明天到期 ${d.tomorrowDue} 个，已毕业累计 ${d.masterTotal} 个`)
  L.push(`⑥ 结论：${d.note}`)
  return L.join('\n')
}

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) { out.push(line); line = ch }
    else line += ch
  }
  if (line) out.push(line)
  return out
}

/** 画成 750 宽的长图，返回 dataURL（页面里用 <img> 显示，微信长按即可保存） */
export function reportImage(d: ReportData, name = '同学'): string {
  const W = 750, pad = 40
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  ctx.font = `15px ${FONT}`

  const lines: { t: string; size: number; color: string; bold?: boolean; gap: number }[] = []
  const push = (t: string, size = 15, color = '#26303d', bold = false, gap = 0) => lines.push({ t, size, color, bold, gap })

  push(`英语听写 · ${d.dayLabel}`, 26, '#1b2430', true, 8)
  push(`${name} · ${d.tier}`, 14, '#7c8794', false, 18)

  push(`① 今天做了什么`, 17, '#2f5fd0', true, 6)
  push(`${d.segN} 段 · 作答 ${d.qN} 题 · 有效学习 ${fmtSec(d.effSec)} · 空闲 ${fmtSec(d.idleSec)}`, 15, '#26303d', false, 16)

  push(`② 分数（首答口径）`, 17, '#2f5fd0', true, 6)
  push(`${d.score} 分   首答对 ${d.right}/${d.noPeekN}${d.peekN ? `   看答案 ${d.peekN} 题不计分` : ''}`, 15, '#26303d', false, 4)
  if (d.prevScore !== null) push(`上次 ${d.prevScore} 分`, 13, '#7c8794', false, 16)

  push(`③ 新词 ${d.newWords.length} 个`, 17, '#2f5fd0', true, 6)
  push(
    d.newWords.length
      ? d.newWords.map(w => `${w.word} ${w.state === 'ok' ? '√' : w.state === 'peek' ? '看答案' : '×'}`).join('   ')
      : '今天不排新词',
    15, '#26303d', false, 16,
  )

  push(`④ 到期复习 ${new Set(d.dueList.map(x => x.word)).size} 个：对 ${d.dueOk} 错 ${d.dueBad}`, 17, '#2f5fd0', true, 6)
  const bad = d.dueList.filter(x => !x.ok)
  push(bad.length ? '错的：' + bad.slice(0, 10).map(x => x.word).join('、') : '全对', 14, bad.length ? '#c0392b' : '#2b8a3e', false, 16)

  push(`⑤ 队列变化`, 17, '#2f5fd0', true, 6)
  push(`今天清掉 ${d.cleared} 个 · 明天到期 ${d.tomorrowDue} 个 · 已毕业 ${d.masterTotal} 个`, 15, '#26303d', false, 16)

  push(`⑥ 结论`, 17, '#2f5fd0', true, 6)

  // 先算高度
  ctx.font = `15px ${FONT}`
  const wrapped: string[][] = []
  for (const l of lines) {
    ctx.font = `${l.bold ? '700 ' : ''}${l.size}px ${FONT}`
    wrapped.push(wrap(ctx, l.t, W - pad * 2))
  }
  ctx.font = `15px ${FONT}`
  const noteLines = wrap(ctx, d.note, W - pad * 2)
  let H = 60
  lines.forEach((l, i) => { H += wrapped[i].length * (l.size + 8) + l.gap + 6 })
  H += noteLines.length * 23 + 70

  const dpr = 2
  cv.width = W * dpr
  cv.height = H * dpr
  const c = cv.getContext('2d')!
  c.scale(dpr, dpr)

  const bg = c.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#f8fafd')
  bg.addColorStop(1, '#edf2f9')
  c.fillStyle = bg
  c.fillRect(0, 0, W, H)

  c.fillStyle = '#ffffff'
  c.strokeStyle = '#e3e9f2'
  c.lineWidth = 1
  const bx = pad - 18, by = 24, bw = W - (pad - 18) * 2, bh = H - 48
  c.beginPath()
  c.rect(bx, by, bw, bh)
  c.fill()
  c.stroke()

  let y = 60
  lines.forEach((l, i) => {
    c.font = `${l.bold ? '700 ' : ''}${l.size}px ${FONT}`
    c.fillStyle = l.color
    for (const s of wrapped[i]) {
      c.fillText(s, pad, y)
      y += l.size + 8
    }
    y += l.gap + 6
  })

  c.font = `15px ${FONT}`
  c.fillStyle = '#26303d'
  for (const s of noteLines) {
    c.fillText(s, pad, y)
    y += 23
  }

  c.fillStyle = '#9aa5b1'
  c.font = `12px ${FONT}`
  c.fillText('英语听写 · 首答口径 · 看答案的题不计分也不计掌握', pad, H - 40)

  return cv.toDataURL('image/png')
}
