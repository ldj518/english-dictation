/**
 * 成绩海报生成：把一次听写结果画成一张适合微信分享的图片。
 *
 * 为什么用 canvas 而不是截图库：
 * - 零依赖，不增加打包体积
 * - 输出固定尺寸（750×~1100），微信里长按保存清晰
 * - 中文字体用系统字体栈，无需打包字体文件
 */

interface PosterData {
  profile: { name: string; emoji: string; color: string }
  trackLabel: string
  date: string
  score: number
  right: number
  total: number
  seconds: number
  answers: { word: string; cn: string; correct: boolean; input: string }[]
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const ss = s % 60
  return m ? `${m}分${ss}秒` : `${ss}秒`
}

/** 生成海报并触发下载/预览 */
export async function sharePoster(d: PosterData): Promise<void> {
  const W = 750
  const pad = 44
  const wrongs = d.answers.filter(a => !a.correct)
  const listRows = Math.min(d.answers.length, 30)
  const H = 520 + listRows * 46 + (wrongs.length ? 70 : 0) + 160

  const cv = document.createElement('canvas')
  const dpr = 2
  cv.width = W * dpr
  cv.height = H * dpr
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)

  const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'

  // 背景：淡雅渐变
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#f7f9fc')
  bg.addColorStop(1, '#eef3f9')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 顶部品牌条
  const head = ctx.createLinearGradient(0, 0, W, 160)
  head.addColorStop(0, '#1c7ed6')
  head.addColorStop(1, '#0ca678')
  ctx.fillStyle = head
  roundRect(ctx, 0, 0, W, 180, 0)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 34px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.fillText('英语听写学习报告', pad, 44)
  ctx.font = `400 24px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(`${d.profile.emoji} ${d.profile.name} · ${d.date}`, pad, 92)

  // 主卡片
  const cy = 216
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(20,40,80,0.12)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  roundRect(ctx, pad, cy, W - pad * 2, 260, 24)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  // 任务名
  ctx.fillStyle = '#868e96'
  ctx.font = `400 24px ${FONT}`
  ctx.fillText(d.trackLabel, pad + 36, cy + 34)

  // 大分数
  const scoreColor = d.score >= 90 ? '#0ca678' : d.score >= 70 ? '#1c7ed6' : d.score >= 50 ? '#f08c00' : '#e03131'
  ctx.fillStyle = scoreColor
  ctx.font = `800 120px ${FONT}`
  ctx.fillText(String(d.score), pad + 36, cy + 76)
  const sw = ctx.measureText(String(d.score)).width
  ctx.font = `700 40px ${FONT}`
  ctx.fillText('%', pad + 40 + sw, cy + 150)

  // 右侧三项
  const rx = W - pad - 36
  const stats: [string, string][] = [
    ['答对', `${d.right}/${d.total}`],
    ['答错', String(d.total - d.right)],
    ['用时', fmtSec(d.seconds)],
  ]
  ctx.textAlign = 'right'
  stats.forEach(([k, v], i) => {
    const yy = cy + 44 + i * 62
    ctx.fillStyle = '#adb5bd'
    ctx.font = `400 22px ${FONT}`
    ctx.fillText(k, rx, yy)
    ctx.fillStyle = '#343a40'
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(v, rx, yy + 26)
  })
  ctx.textAlign = 'left'

  // 逐题清单
  let y = cy + 296
  ctx.fillStyle = '#495057'
  ctx.font = `800 28px ${FONT}`
  ctx.fillText(wrongs.length ? `错词回顾（${wrongs.length}）` : '本次成绩', pad, y)
  y += 44

  ctx.fillStyle = '#ffffff'
  roundRect(ctx, pad, y, W - pad * 2, listRows * 46 + 24, 20)
  ctx.fill()

  const rows = wrongs.length ? wrongs.slice(0, listRows) : d.answers.slice(0, listRows)
  let ry = y + 30
  rows.forEach((a) => {
    ctx.fillStyle = a.correct ? '#0ca678' : '#e03131'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(a.correct ? '✓' : '✗', pad + 30, ry)
    ctx.fillStyle = '#212529'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(a.word, pad + 62, ry)
    ctx.fillStyle = '#868e96'
    ctx.font = `400 22px ${FONT}`
    const ww = ctx.measureText(a.word).width
    ctx.fillText(a.cn, pad + 74 + ww, ry + 3)
    if (!a.correct && a.input) {
      ctx.textAlign = 'right'
      ctx.fillStyle = '#c92a2a'
      ctx.font = `400 22px ${FONT}`
      ctx.fillText(`你写: ${a.input}`, W - pad - 30, ry + 3)
      ctx.textAlign = 'left'
    }
    ry += 46
  })

  // 页脚
  const fy = H - 100
  ctx.fillStyle = '#adb5bd'
  ctx.font = `400 22px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('在线英语听写 · tingxie.5208090.xyz', W / 2, fy)
  ctx.fillText('每天听写一点点，英语成绩看得见', W / 2, fy + 32)
  ctx.textAlign = 'left'

  // 输出
  const url = cv.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `听写成绩_${d.profile.name}_${d.date}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // 移动端：同时弹出预览，方便长按保存
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>听写成绩单</title>
<body style="margin:0;background:#222;display:flex;justify-content:center;padding:12px">
<img src="${url}" style="width:100%;max-width:420px;border-radius:12px">
<p style="color:#aaa;font:14px/1.6 sans-serif;position:fixed;bottom:8px;width:100%;text-align:center">
长按图片保存到相册，再发到微信</p></body>`)
    w.document.close()
  }
}

/* ── 每周报告海报（v3.4）────────────────────────────── */

export interface WeekPosterData {
  profile: { name: string; emoji: string; color: string }
  dateRange: string
  acc: number | null
  accDelta: number | null
  days: number
  sessions: number
  minutes: number
  newWrongs: { word: string; cn: string; count: number }[]
  passedUnits: { unit: string; score: number }[]
  advice: string
}

/** 生成周报海报并触发下载/预览（结构上复用 sharePoster 的画法） */
export async function weekPoster(d: WeekPosterData): Promise<void> {
  const W = 750
  const pad = 44
  const rows = d.newWrongs.length
  const H = 660 + rows * 52 + (d.passedUnits.length ? 96 : 0) + 150

  const cv = document.createElement('canvas')
  const dpr = 2
  cv.width = W * dpr
  cv.height = H * dpr
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)

  const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#f7f9fc')
  bg.addColorStop(1, '#eef3f9')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 顶部品牌条
  const head = ctx.createLinearGradient(0, 0, W, 180)
  head.addColorStop(0, '#5f3dc4')
  head.addColorStop(1, '#1c7ed6')
  ctx.fillStyle = head
  ctx.fillRect(0, 0, W, 180)

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 34px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.fillText('英语听写 · 本周报告', pad, 44)
  ctx.font = `400 24px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(`${d.profile.emoji} ${d.profile.name} · ${d.dateRange}`, pad, 92)

  // 主卡片：正确率 + 环比
  const cy = 216
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(20,40,80,0.12)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  roundRect(ctx, pad, cy, W - pad * 2, 250, 24)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.fillStyle = '#868e96'
  ctx.font = `400 24px ${FONT}`
  ctx.fillText('本周正确率（只和自己比）', pad + 36, cy + 34)

  const acc = d.acc ?? 0
  const scoreColor = acc >= 90 ? '#0ca678' : acc >= 70 ? '#1c7ed6' : acc >= 50 ? '#f08c00' : '#e03131'
  ctx.fillStyle = scoreColor
  ctx.font = `800 110px ${FONT}`
  ctx.fillText(String(acc), pad + 36, cy + 78)
  const sw = ctx.measureText(String(acc)).width
  ctx.font = `700 38px ${FONT}`
  ctx.fillText('%', pad + 40 + sw, cy + 148)

  if (d.accDelta !== null) {
    const up = d.accDelta >= 0
    ctx.fillStyle = up ? '#0ca678' : '#e03131'
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(`${up ? '▲' : '▼'} ${Math.abs(d.accDelta)}%`, pad + 40 + sw + 62, cy + 152)
  } else {
    ctx.fillStyle = '#adb5bd'
    ctx.font = `400 24px ${FONT}`
    ctx.fillText('上周无数据，本周起就有对比了', pad + 40 + sw + 62, cy + 156)
  }

  // 三格小指标
  const gy = cy + 196
  const cells: [string, string][] = [
    ['练习天数', `${d.days} 天`],
    ['完成卷数', `${d.sessions} 卷`],
    ['学习时长', `${d.minutes} 分钟`],
  ]
  cells.forEach(([k, v], i) => {
    const cx = pad + 36 + i * ((W - pad * 2 - 72) / 3)
    ctx.fillStyle = '#adb5bd'
    ctx.font = `400 20px ${FONT}`
    ctx.fillText(k, cx, gy)
    ctx.fillStyle = '#343a40'
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(v, cx, gy + 28)
  })

  // 过关条（如有）
  let y = cy + 296
  if (d.passedUnits.length) {
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, pad, y, W - pad * 2, 72, 20)
    ctx.fill()
    ctx.font = `700 26px ${FONT}`
    ctx.fillStyle = '#0ca678'
    ctx.fillText('🏅', pad + 26, y + 22)
    ctx.fillStyle = '#212529'
    ctx.fillText(
      `本周过关：${d.passedUnits.map(p => `${p.unit.replace('unit', 'Unit ')} ${p.score}分`).join(' · ')}`,
      pad + 62, y + 22,
    )
    y += 96
  }

  // 新增错词
  ctx.fillStyle = '#495057'
  ctx.font = `800 28px ${FONT}`
  ctx.fillText(rows ? `本周新增错词 TOP${rows}` : '本周没有新增错词', pad, y)
  y += 44
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, pad, y, W - pad * 2, Math.max(1, rows) * 52 + 24, 20)
  ctx.fill()

  let ry = y + 34
  for (const w of d.newWrongs) {
    ctx.fillStyle = '#e03131'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(w.word, pad + 30, ry)
    ctx.fillStyle = '#868e96'
    ctx.font = `400 22px ${FONT}`
    const ww = ctx.measureText(w.word).width
    ctx.fillText(w.cn, pad + 44 + ww, ry + 3)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#f08c00'
    ctx.fillText(`错 ${w.count} 次`, W - pad - 30, ry + 3)
    ctx.textAlign = 'left'
    ry += 52
  }
  if (!rows) {
    ctx.fillStyle = '#0ca678'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText('全都答对了，基础在变扎实 👏', pad + 30, ry)
  }

  // 下周建议
  y += Math.max(1, rows) * 52 + 40
  ctx.fillStyle = '#ffffff'
  const adviceH = 110
  roundRect(ctx, pad, y, W - pad * 2, adviceH, 20)
  ctx.fill()
  ctx.fillStyle = '#5f3dc4'
  ctx.font = `700 26px ${FONT}`
  ctx.fillText('📌 下周建议', pad + 26, y + 20)
  ctx.fillStyle = '#495057'
  ctx.font = `400 24px ${FONT}`
  // 简单换行（每行 ~26 字）
  const text = d.advice
  const lineChars = 24
  for (let i = 0; i * lineChars < text.length && i < 2; i++) {
    ctx.fillText(text.slice(i * lineChars, (i + 1) * lineChars), pad + 26, y + 58 + i * 34)
  }

  // 页脚
  const fy = H - 96
  ctx.fillStyle = '#adb5bd'
  ctx.font = `400 22px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('在线英语听写 · tingxie.5208090.xyz', W / 2, fy)
  ctx.textAlign = 'left'

  const url = cv.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `本周报告_${d.profile.name}_${d.dateRange.replace('~', '-')}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  const w2 = window.open('', '_blank')
  if (w2) {
    w2.document.write(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本周报告</title>
<body style="margin:0;background:#222;display:flex;justify-content:center;padding:12px">
<img src="${url}" style="width:100%;max-width:420px;border-radius:12px">
<p style="color:#aaa;font:14px/1.6 sans-serif;position:fixed;bottom:8px;width:100%;text-align:center">
长按图片保存到相册，再发到微信</p></body>`)
    w2.document.close()
  }
}
