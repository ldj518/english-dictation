import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getTrack, loadAudioIndex, tuplesToItems } from '../lib/data'
import { useStore } from '../lib/store'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import { todayStr } from '../lib/storage'
import { buildA4Pdf, downloadPdf, type PdfBlock } from '../lib/pdf'
import type { AudioItem } from '../types'

/**
 * 纸质听写卷（防泄题设计）。
 *
 * 硬规则（用户明确要求）：
 * - 一张卷只印一种信息形态：要么全是中文释义（孩子写英文），要么全留白（家长读）
 * - 严禁中英混排出现在同一张卷的答题区
 * - 答案只在「答案版」出现，且默认不打印
 *
 * 两种卷面：
 * - writing（汉译英）：给中文释义，留横线写英文
 * - blank（纯听写）：只留题号+横线，家长/音频报词，孩子写英文
 * - answer（答案版）：中文 + 英文对照，供家长批改用，页面明确标注「批改专用」
 */
export default function PrintSheet() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { progress, profile } = useStore()
  const track = getTrack(id)

  const [mode, setMode] = useState<'writing' | 'blank' | 'answer'>('writing')
  const [items, setItems] = useState<AudioItem[]>([])
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!track) return
    let cancel = false
    loadAudioIndex().then(idxMap => {
      if (cancel) return
      const fromAudio = idxMap[track.id]
      let list: AudioItem[] = tuplesToItems(track.items)
      if (fromAudio && fromAudio.length) {
        list = fromAudio.map((a, i) => ({
          no: a.no ?? i + 1,
          word: a.word,
          cn: a.cn || track.items[i]?.[2] || '',
          file: a.file,
        }))
      }
      // 打印卷也按同一种子洗牌，保证「线上做的顺序」与「纸上做的顺序」一致
      if (progress.settings.shuffle && list.length > 1) {
        list = seededShuffle(list, makeSeed(todayStr(), profile.id, track.id))
      }
      setItems(list)
    })
    return () => { cancel = true }
  }, [track, profile.id, progress.settings.shuffle])

  const title = track ? (track.label || `第 ${track.order} 天`) : ''
  const dateStr = todayStr()

  /** 生成并下载真正的 A4 PDF 文件 */
  const exportPdf = () => {
    if (!track || !items.length) { setHint('还没有题目，稍等一下再试'); return }
    setBusy(true)
    setHint('')
    try {
      const blocks: PdfBlock[] = items.map((it, i) => ({
        type: 'item',
        no: String(i + 1).padStart(2, '0'),
        left: mode === 'blank' ? '' : it.cn,
        right: mode === 'answer' ? it.word : undefined,
        line: mode !== 'answer',
      }))
      const nameMap = { writing: '汉译英', blank: '纯听写', answer: '答案版' } as const
      const blob = buildA4Pdf({
        title: '英语单词听写',
        meta: [`姓名：${profile.name}`, `日期：${dateStr}`, `内容：${title}（${nameMap[mode]}）`],
        blocks,
        watermark: mode === 'answer' ? '批改专用' : undefined,
        footer: `在线练习：tingxie.5208090.xyz · 共 ${items.length} 题`,
        perPage: 30,
      })
      downloadPdf(blob, `听写卷_${profile.name}_${title}_${dateStr}.pdf`)
      setHint('✅ PDF 已生成。若手机没自动弹出，请到「文件 / 下载」里找 —— 微信里请点右上角「…」→ 用浏览器打开，再用浏览器打印。')
    } catch (e) {
      setHint('生成 PDF 失败：' + ((e as Error)?.message || '未知错误') + '。可改用「直接打印」。')
    } finally {
      setBusy(false)
    }
  }

  /** 打印：微信/手机内置浏览器常不支持 window.print，给出替代指引 */
  const doPrint = () => {
    const ua = navigator.userAgent
    const inWechat = /MicroMessenger/i.test(ua)
    try {
      if (inWechat) {
        setHint('⚠️ 微信内置浏览器不支持直接打印。请点右上角「…」→「在浏览器打开」，或用上面的「下载 A4 PDF」再打印。')
        return
      }
      window.print()
    } catch {
      setHint('当前浏览器不支持直接打印，请用「下载 A4 PDF」。')
    }
  }

  /** 卷面信息（打印时用） */
  const head = (
    <div className="sheetHead">
      <div className="shTitle">英语单词听写</div>
      <div className="shMeta">
        <span>姓名：{profile.emoji} {profile.name} ________________</span>
        <span>日期：{dateStr}</span>
        <span>内容：{title}</span>
      </div>
      <div className="shScore">
        {mode === 'answer'
          ? <>共 {items.length} 题 · 批改专用</>
          : <>得分：________ / {items.length * 10}&nbsp;&nbsp;&nbsp;批改签字：____________</>}
      </div>
    </div>
  )

  return (
    <div className="printWrap">
      {/* 控制条（打印时隐藏） */}
      <div className="ctrl no-print">
        <button className="btn ghost sm" onClick={() => nav(-1)}>‹ 返回</button>
        <div className="seg">
          <button className={mode === 'writing' ? 'on' : ''} onClick={() => setMode('writing')}>汉译英卷</button>
          <button className={mode === 'blank' ? 'on' : ''} onClick={() => setMode('blank')}>纯听写卷</button>
          <button className={mode === 'answer' ? 'on' : ''} onClick={() => setMode('answer')}>答案版</button>
        </div>
        <button className="btn" style={{ background: '#d9480f' }} onClick={exportPdf} disabled={busy}>
          {busy ? '⏳ 生成中…' : '⬇️ 下载 A4 PDF'}
        </button>
        <button className="btn ghost" onClick={doPrint}>🖨️ 直接打印</button>
      </div>

      {hint && (
        <div className="tip no-print" style={{ background: '#fff4e6', color: '#b45309', fontWeight: 600 }}>
          {hint}
        </div>
      )}

      <div className="tip no-print">
        {mode === 'writing' && '给中文释义，孩子在横线上写英文单词。适合孩子独立完成。'}
        {mode === 'blank' && '只有题号和横线，家长（或音频）报英文，孩子写单词。纯听力练习。'}
        {mode === 'answer' && '中英对照，仅供家长批改。请勿给孩子看到。打印时会带上"批改专用"水印。'}
      </div>

      {/* 手机上怎么打印 —— 微信内置浏览器不支持直接打印，必须说清楚 */}
      <div className="tip no-print" style={{ background: '#f1f3f5', color: '#495057' }}>
        <b>手机怎么打印？</b><br />
        ① 点「⬇️ 下载 A4 PDF」→ 存到手机<br />
        ② 微信里打开本页的：点右上角 <b>…</b> → <b>在浏览器打开</b><br />
        ③ 用 WPS / 手机自带「打印」打开这个 PDF 即可（电脑上直接 Ctrl+P）
      </div>

      {/* ── 卷面 ── */}
      <div className={'sheet' + (mode === 'answer' ? ' sheet-answer' : '')}>
        {head}

        {mode === 'answer' && <div className="wm">批改专用</div>}

        <div className="qlist">
          {items.map((it, i) => (
            <div className="qitem" key={it.word + i}>
              <span className="qno">{String(i + 1).padStart(2, '0')}.</span>
              {mode === 'writing' && (
                <span className="qcn">{it.cn}</span>
              )}
              {mode === 'blank' && <span className="qcn qcn-blank">（　　　　　　　　　）</span>}
              {mode === 'answer' && (
                <>
                  <span className="qcn">{it.cn}</span>
                  <span className="qans">{it.word}</span>
                </>
              )}
              {mode !== 'answer' && <span className="qline" />}
            </div>
          ))}
        </div>

        <div className="sheetFoot">
          共 {items.length} 题 · 在线练习：tingxie.5208090.xyz
        </div>
      </div>

      {mode === 'answer' && (
        <div className="sheet no-print" style={{ marginTop: 20 }}>
          <div className="shTitle" style={{ fontSize: 18, marginBottom: 12 }}>📱 纸质卷做完后：拍照批改</div>
          <div className="sub small" style={{ lineHeight: 1.9 }}>
            1. 把这张纸质卷打印出来，让孩子手写完成<br />
            2. 写完拍张照（拍清楚，别歪）<br />
            3. 回到应用 <b>首页 → 纸质批改</b>，选这个任务，逐题对答案勾选 ✓/✗<br />
            4. 系统自动算分，写进孩子的学习记录和错词本
          </div>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <a className="btn" href={`#/paper/${track?.id}`}>去批改 →</a>
          </div>
        </div>
      )}
    </div>
  )
}
