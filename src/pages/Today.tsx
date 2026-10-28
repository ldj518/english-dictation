/**
 * Today —— v4 每日会话（唯一的日常学习入口）。
 *
 * 和老流程的根本区别：
 *  老：每天固定 5 关，做完就结束（10 分钟点完也算完成）
 *  新：30′/60′ 是**有效时间下限**，题量按手速倒推；双闸门（时间够 + 必做清空）
 *      缺一个都不结算、不给星、不算打卡。
 *
 * 防敷衍六条（每条都能在代码里找到落点）：
 *  ① 速答不计掌握 —— gradeOne 收到 fast 时 S 只 ×1.5
 *  ② 答错必重做，分数按首答 —— 见 grade() 与 redo 流程
 *  ③ 两段式确认 —— pick 必须「选中 → 确定」
 *  ④ 看答案扣分母 —— peek 题不进 score 分子分母
 *  ⑤ 有效时间才算 —— EffTimer 只累加间隔 ≤60 秒的时长
 *  ⑥ 同词当日只判一次 —— gradedRef 记已判词
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import LetterKeyboard from '../components/LetterKeyboard'
import { useStore } from '../lib/store'
import { WORDS } from '../lib/data'
import { wordFileMap, playWordText } from '../lib/data'
import { bjDayKey, bjDiffDays, fmtSec, fmtSecCn } from '../lib/bj'
import { buildPlan, gateCheck, mergeCfg, mustTotalOf, settleDaysLeft, perItemSecOf, rampWeekOf, capHit, type DayPlan } from '../lib/plan'
import { queueHealth, dueWordList } from '../lib/memory'
import { buildReport, reportText, reportImage } from '../lib/report'
import { reportOut } from '../lib/api'
import {
  buildQBank, extraDrill, cnOf, judgeSentence, SENTENCES, type Q, type QBank,
} from '../lib/qbank'
import { EffTimer } from '../lib/timer'
import { unlockAudio } from '../lib/player'
import { todayStr } from '../lib/storage'
import { nextGate, unitName } from '../lib/gate'
import { reportDay } from '../lib/api'
import { judge, judgeWithFirst } from '../lib/storage'
import { syllableText } from '../lib/syllables'
import type { DayLog } from '../types'

/** 单题结果（首答计入分数） */
interface Rec {
  word: string
  kind: string
  correct: boolean
  peek: boolean
  fast: boolean
  hinted: boolean
  ms: number
  input: string
  /** 属于第几段（-1 = 补充练习） */
  seg: number
  must: boolean
}

type Phase = 'loading' | 'start' | 'run' | 'wrap'

export default function Today() {
  const nav = useNavigate()
  const { progress, profile, gradeOne, saveDay, saveLive } = useStore()

  const day = todayStr()
  const cfg = useMemo(() => mergeCfg(progress.studyCfg), [progress.studyCfg])

  const [phase, setPhase] = useState<Phase>('loading')
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [bank, setBank] = useState<QBank | null>(null)
  const [qi, setQi] = useState(0)
  const [recs, setRecs] = useState<Rec[]>([])
  const [fileMap, setFileMap] = useState<Map<string, string>>(new Map())
  const [err, setErr] = useState('')
  const [dueTotal, setDueTotal] = useState(0)

  // 答题交互状态
  const [sel, setSel] = useState<string | null>(null)      // 选中的选项 key
  const [choiceOrder, setChoiceOrder] = useState<{ key: string; text: string }[]>([])
  const [input, setInput] = useState('')
  const [tries, setTries] = useState(0)                    // 本题已错次数
  const [verdict, setVerdict] = useState<'' | 'ok' | 'bad'>('')
  const [peeked, setPeeked] = useState(false)
  const [showCn, setShowCn] = useState(false)              // 拼写题中文提示是否已点开
  const [taught, setTaught] = useState(false)              // 教学卡是否已看中文
  const [picked, setPicked] = useState<{ idx: number; text: string }[]>([])  // 句子已选词块
  const [pool, setPool] = useState<number[]>([])           // 句子剩余词块下标

  // 计时
  const timer = useRef<EffTimer | null>(null)
  const qStart = useRef<number>(Date.now())
  const [tick, setTick] = useState(0)
  const gradedRef = useRef<Set<string>>(new Set())         // 同词当日只判一次分
  const audioRef = useRef<Map<string, string>>(new Map())

  /* ── 构建今日会话 ──────────────────────────────────── */

  // progress 走 ref：判一题就会 setProgress，若 build 依赖 progress，
  // 每答一题都会重建会话并重置回开始页（实测就是这个 bug，答完第 5 题整个会话重开）。
  const progRef = useRef(progress)
  progRef.current = progress

  const build = useCallback(async () => {
    const pg = progRef.current
    const fm = await wordFileMap().catch(() => new Map<string, string>())
    setFileMap(fm)
    audioRef.current = fm

    const state = pg.wordState || {}
    const h = queueHealth(pg, day)
    const gap = pg.lastDay ? Math.max(0, bjDiffDays(day, pg.lastDay)) : 0

    // 单题耗时取近 7 天实测（有效时间 ÷ 作答数）。以前写死 20 秒，
    // 「按手速倒推题量」等于没做——快手慢手排出来一模一样。
    const perItem = perItemSecOf(pg, day)

    // 还有没有没学过的词（决定今天能不能上新词）
    const fresh = WORDS.filter(w => !state[w.word])
    const hasNew = fresh.length > 0

    const p = buildPlan({
      dayKey: day,
      gapDays: gap,
      dueN: h.due,
      weakN: h.weak,
      nailN: h.nails,
      forgetRate: h.forgetRate,
      perItemSec: perItem,
      hasNew,
      rampWeek: rampWeekOf(pg.rampFrom || day, day),
      cfg: pg.studyCfg,
    })
    setPlan(p)

    // 到期词（按风险排）→ 取今天该做的数
    const dueAll = dueWordList(pg, day, cnOf)
    setDueTotal(dueAll.length)
    const due = dueAll.slice(0, p.dueN).map(x => ({ word: x.word, cn: x.cn }))
    const nails = dueAll.filter(x => x.state.lapses >= 4).slice(0, 10).map(x => ({ word: x.word, cn: x.cn }))

    // 新词：按词表顺序取第一个还没状态的（天然接着教材走）
    const newWords = fresh.slice(0, p.newN).map(w => ({ word: w.word, cn: cnOf(w.word) }))

    if (!due.length && !newWords.length) {
      setErr('还没有可学的词。先去做一次听写或单元测，系统会建立记忆状态。')
      setPhase('start')
      return
    }

    const b = buildQBank({
      plan: p, dueWords: due, newWords, nailWords: nails,
      fileMap: fm, profileId: profile.id,
    })
    setBank(b)
    setQi(0)
    setRecs([])
    gradedRef.current = new Set()
    gradedQRef.current = new Set()
    setPhase('start')
  }, [day, profile.id])

  useEffect(() => { void build() }, [build])

  /* ── 计时器：启动 + 每秒刷新 + 切后台暂停 ── */
  useEffect(() => {
    if (phase !== 'run') return
    if (!timer.current) timer.current = new EffTimer(cfg.idleGapMs)
    const id = window.setInterval(() => setTick(t => t + 1), 1000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') timer.current?.pause()
      else timer.current?.resume()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [phase, cfg.idleGapMs])

  const snap = timer.current ? timer.current.snap() : { effSec: 0, idleSec: 0, wallSec: 0, taps: 0, sinceLastTap: 0 }
  void tick

  /* ── 封顶：到点强制收尾。不设的话他会发现「慢慢做反而不用加」，最优策略变磨洋工 ── */
  const [capped, setCapped] = useState(false)
  const [poster, setPoster] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (phase !== 'run' || !plan) return
    if (!capHit(plan, snap.effSec)) return
    setCapped(true)
    setPhase('wrap')
  }, [phase, plan, snap.effSec])

  /* ── 当前题 ── */
  const q: Q | null = bank ? bank.qs[qi] || null : null
  const segs = plan?.segs || []
  const curSeg = q ? segs[q.seg] : null

  /** 必做进度 */
  const mustAll = bank ? bank.qs.filter(x => x.must).length : 0
  // 必做 = 做完就算（不要求做对）。
  // 要求「全做对」是死结：一个词都不会的孩子点一百遍也达不成，第二天照样从头再来。
  // 「掌握没掌握」由 S 和分数管，闸门只管「量有没有走到」。
  const mustDone = recs.filter(r => r.must).length

  /* ── 进入题目：复位交互状态并预播音频 ── */
  useEffect(() => {
    if (!q) return
    setSel(null); setInput(''); setTries(0); setVerdict(''); setPeeked(false)
    setShowCn(false); setTaught(false); setPicked([])
    qStart.current = Date.now()
    if (q.kind === 'pick' && q.options) {
      setChoiceOrder(q.options.slice())
    }
    if (q.kind === 'sent' && q.tokens) {
      setPool(q.order ? q.order.slice() : q.tokens.map((_, i) => i))
    }
    // 听力题必须自动播：孩子没听到就选＝瞎猜。播不出来由 player 内部兜底提示
    if (q.kind === 'pick' || q.kind === 'flash' || q.kind === 'spell') void play(q)
    setTick(t => t + 1)
  }, [qi, q?.id])

  /* ── 播放 ── */
  const play = useCallback(async (qq: Q | null, slow = false) => {
    if (!qq) return
    unlockAudio()
    await playWordText(qq.word, slow ? 0.7 : 1)
  }, [])

  /* ── 判分 ── */

  /**
   * 记一题。
   * @param correct 首答是否正确
   * @param peek 是否点了「不会，看答案」
   * @param hinted 是否用过提示
   */
  const gradedQRef = useRef<Set<string>>(new Set())   // 已记过分的题 id

  /* ── 分段进出（v5）：看孩子卡在哪一段。按 seg 序号聚，切段时关上一段 ── */
  const segStats = useRef<Record<number, { enterAt: number; leaveAt: number; qN: number; rightN: number; peekN: number }>>({})
  const segCur = useRef<number>(-1)
  useEffect(() => {
    if (!q) return
    const idx = q.seg
    const m = segStats.current
    if (segCur.current >= 0 && segCur.current !== idx && m[segCur.current] && !m[segCur.current].leaveAt) {
      m[segCur.current].leaveAt = Date.now()
    }
    if (!m[idx]) m[idx] = { enterAt: Date.now(), leaveAt: 0, qN: 0, rightN: 0, peekN: 0 }
    segCur.current = idx
  }, [q])

  const grade = useCallback((correct: boolean, opts: { peek?: boolean; hinted?: boolean } = {}) => {
    if (!q) return
    timer.current?.tap()
    // 一道题只记一次。答错重做时若再记一遍，必做会变成 57/43、总作答会虚高，
    // 战报和后台统计全跟着错（实测就是这个）。
    if (gradedQRef.current.has(q.id)) return
    gradedQRef.current.add(q.id)
    const ms = EffTimer.lapMs(qStart.current)
    const fast = ms < cfg.fastMs && correct && !opts.hinted
    const rec: Rec = {
      word: q.word, kind: q.kind, correct: !opts.peek && correct,
      peek: !!opts.peek, fast, hinted: !!opts.hinted, ms,
      input: '', seg: q.seg, must: q.must,
    }
    setRecs(prev => [...prev, rec])
    const st = segStats.current[q.seg]
    if (st) {
      st.qN += 1
      if (rec.correct) st.rightN += 1
      if (rec.peek) st.peekN += 1
    }

    // 同词当日只判一次：第二次起只练不判（防重刷把分刷高）
    if (q.scored && !gradedRef.current.has(q.word)) {
      gradedRef.current.add(q.word)
      gradeOne(q.word, rec.correct, {
        hinted: opts.hinted || !!opts.peek,
        fast: fast,
      })
    }
  }, [q, cfg.fastMs, gradeOne])

  /** 下一题 */
  const next = useCallback(() => {
    if (!bank) return
    if (qi + 1 >= bank.qs.length) { setPhase('wrap'); return }
    setQi(i => i + 1)
  }, [bank, qi])

  /** 结算落库 */
  const savedRef = useRef<string>('')
  useEffect(() => {
    if (phase !== 'wrap' || !plan || !bank) return
    if (savedRef.current === day) return     // 同一天只写一次，防 effect 重入覆盖
    savedRef.current = day
    const perf = [...recs]
    // 先算闸门再落库：done 是双闸门的结论，不能写死 false
    const gate0 = gateCheck({
      effSec: timer.current?.snap().effSec || 0, plan,
      mustDone: perf.filter(r => r.must).length, mustTotal: mustAll,
      peekN: perf.filter(r => r.peek).length, qN: perf.length,
    })
    const qN = perf.filter(r => !r.peek).length
    const rightN = perf.filter(r => !r.peek && r.correct).length
    const peekN = perf.filter(r => r.peek).length
    const log: DayLog = {
      dayKey: day,
      tier: plan.tier,
      effSec: timer.current?.snap().effSec || 0,
      idleSec: timer.current?.snap().idleSec || 0,
      mustDone: perf.filter(r => r.must).length,
      mustTotal: mustAll,
      qN, rightN, peekN,
      done: gate0.done,
      segs: plan.segs.map((s, i) => ({
        k: s.k, label: s.label, min: s.min, q: s.q,
        right: perf.filter(r => r.seg === i && r.correct).length,
      })),
      segDone: [],
      at: Date.now(),
    }
    saveDay(log)
    saveLive(null)

    // 战报归档（v5）：六块文本 + 结构化 payload，家长页可回看/复制
    try {
      const rd = buildReport(progRef.current, plan, perf, day)
      void reportOut({
        studentId: profile.id, dayKey: day,
        text: reportText(rd), payload: rd,
      }).catch(() => { /* 归档失败不影响学习 */ })
    } catch { /* 拼装失败也不拦结算 */ }

    // 上报云端（fire-and-forget）：只推今天碰过的词，不全量推 368 个
    const touched = Array.from(new Set(perf.map(r => r.word)))
    const ws = progRef.current.wordState || {}
    void reportDay({
      studentId: profile.id,
      dayKey: day,
      tier: log.tier,
      effSec: log.effSec, idleSec: log.idleSec,
      mustDone: log.mustDone, mustTotal: log.mustTotal,
      qN: log.qN, rightN: log.rightN, peekN: log.peekN,
      done: log.done,
      segs: log.segs,
      // v5：计划快照 + 分段进出，家长后台能回答「为什么只排这几段」「卡在哪段」
      plan: {
        tier: plan.tier, minMin: plan.minMin, maxMin: plan.maxMin, targetQ: plan.targetQ,
        dueN: plan.dueN, newN: plan.newN, perItemSec: plan.perItemSec, rampWeek: plan.rampWeek,
        segs: plan.segs.map(s => ({ k: s.k, label: s.label, min: s.min, q: s.q })),
      },
      segLogs: Object.keys(segStats.current)
        .map(Number)
        .sort((a, b) => a - b)
        .map(i => {
          const st = segStats.current[i]
          return {
            segIndex: i, k: plan.segs[i]?.k || '',
            enterAt: st.enterAt, leaveAt: st.leaveAt || Date.now(),
            qN: st.qN, rightN: st.rightN, peekN: st.peekN,
          }
        }),
      words: touched.map(w => {
        const s = ws[w]
        return s
          ? { word: w, s: s.S, due: s.due, lapses: s.lapses, streak: s.streak, master: s.master, ok: s.ok, n: s.n }
          : { word: w, s: 1, due: day, lapses: 0, streak: 0, master: 0, ok: 0, n: 0 }
      }),
    }).catch(() => { /* 后端挂了不影响本地 */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /* ── 时间不够：追加练习 ── */
  const addDrill = useCallback((n = 12) => {
    if (!bank) return
    // 已封顶就别再加了，否则 effect 会立刻把它拽回结算页，变成来回跳
    if (plan && capHit(plan, timer.current?.snap().effSec || 0)) return
    // 优先用今天做错的词，其次用到期词
    const wrongOnes = Array.from(new Set(recs.filter(r => !r.correct || r.peek).map(r => r.word)))
    const pool2 = wrongOnes.length
      ? wrongOnes.map(w => ({ word: w, cn: cnOf(w) }))
      : bank.qs.filter(x => x.scored).slice(0, 10).map(x => ({ word: x.word, cn: x.cn }))
    const extra = extraDrill(pool2, n, audioRef.current, `${day}|${profile.id}|extra|${Date.now()}`, bank.qs.length)
    if (!extra.length) return
    setBank({ ...bank, qs: [...bank.qs, ...extra] })
    // 补练后再结算必须重新落库，否则「补完 30 分钟」的结果写不进去（savedRef 还停在上一次）
    savedRef.current = ''
    setPhase('run')
  }, [bank, recs, day, profile.id, plan])

  /* ── 渲染 ── */

  if (phase === 'loading') {
    return <Shell title="今天"><div className="empty">正在准备今天的题…</div></Shell>
  }

  if (err) {
    return (
      <Shell title="今天" back>
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 6 }}>今天没有内容可排</div>
          <div className="sub small">{err}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/')}>回首页</button>
        </div>
      </Shell>
    )
  }

  if (!plan || !bank) return <Shell title="今天"><div className="empty">加载中…</div></Shell>

  const minSec = plan.minMin * 60
  const timePct = Math.min(100, Math.round((snap.effSec / minSec) * 100))
  const mustPct = mustAll ? Math.round((mustDone / mustAll) * 100) : 100

  /* 开始页 */
  if (phase === 'start') {
    return (
      <Shell title="今天" back>
        <div className="card pad">
          <div className="between" style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>今天这一场</div>
            <div className="sub small">{plan.tierNote}</div>
          </div>
          <div className="v4kpis">
            <div className="v4kpi">
              <div className="v">{[...segs].filter(s => s.k !== 'wrap').length}</div>
              <div className="l">段</div>
            </div>
            <div className="v4kpi">
              <div className="v">≥{plan.minMin}′</div>
              <div className="l">有效时间下限</div>
            </div>
            <div className="v4kpi">
              <div className="v">{mustAll}</div>
              <div className="l">必做题</div>
            </div>
            <div className="v4kpi">
              <div className="v">{plan.dueN}</div>
              <div className="l">到期词</div>
            </div>
          </div>

          <div className="v4segl">
            {segs.filter(s => s.k !== 'wrap').map((s, i) => (
              <div key={i} className="v4segrow">
                <span className="v4segn">{i + 1}</span>
                <span className="v4segname">{s.label}</span>
                <span className="v4segmin">{s.q > 0 ? `${s.q} 题 · ` : ''}{s.min}′</span>
              </div>
            ))}
          </div>

          {plan.tier === 'settle' && (
            <div className="v4note bad">
              你有 <b>{dueTotal}</b> 个词到期，堆了不少。今天先集中清 <b>{plan.dueN}</b> 个，
              新词暂停
              {plan.dueN >= dueTotal
                ? '，一次清完。'
                : `，剩下的 ${dueTotal - plan.dueN} 个明天接着清（约 ${settleDaysLeft(dueTotal - plan.dueN, cfg)} 天走完）。`}
            </div>
          )}
          {plan.tier === 'recover' && (
            <div className="v4note">
              断了 {plan.gapDays} 天，今天先只复习，不上新词。到期的词不会消失，做完今天就够了。
            </div>
          )}

          {!!progRef.current.dayLog?.[day]?.effSec && (
            <div className="v4note ok">
              今天已经学了 <b>{fmtSec(progRef.current.dayLog[day].effSec)}</b> 有效时间，接着做就行，不用重来。
            </div>
          )}
          <div className="v4note">
            <b>这场什么时候结束？</b>两件事都做到才算完：① 有效学习时间够 {plan.minMin} 分钟（挂机不算），
            ② 必做 {mustAll} 题做完（做错也算做完，但要重做一次）。
          </div>

          <button className="btn" style={{ marginTop: 14 }} onClick={() => {
            unlockAudio()
            if (!timer.current) {
              // 接着当天已累计的时间算（中途退出不清零）
              const prev = progRef.current.dayLog?.[day]
              timer.current = new EffTimer(cfg.idleGapMs, Date.now(), {
                effSec: prev?.effSec || 0, idleSec: prev?.idleSec || 0,
              })
            }
            setPhase('run')
          }}>
            ▶ 开始
          </button>
        </div>
      </Shell>
    )
  }

  /* 结算页 */
  if (phase === 'wrap') {
    const noPeek = recs.filter(r => !r.peek)
    const rightN = noPeek.filter(r => r.correct).length
    const score = noPeek.length ? Math.round((rightN / noPeek.length) * 100) : 0
    const peekRate = recs.length ? recs.filter(r => r.peek).length / recs.length : 0
    const gate = gateCheck({
      effSec: snap.effSec, plan, mustDone,
      mustTotal: mustAll, peekN: recs.filter(r => r.peek).length, qN: recs.length,
    })
    const wrongList = Array.from(new Set(recs.filter(r => !r.correct || r.peek).map(r => r.word)))
    const restSec = Math.max(0, minSec - snap.effSec)
    // 今天达标了、又正好有单元够格考 → 结算页直接给入口，不用回首页再点一次
    const gateNext = gate.done ? nextGate(progRef.current, day) : null

    return (
      <Shell title="今天" noNav>
        <div className={'card pad v4wrap' + (gate.done ? ' ok' : '')}>
          <div className="v4verdict">{gate.done ? '✓ 今天完成' : '未完成'}</div>
          <div className="v4score">{score}<span>分</span></div>
          <div className="sub small" style={{ textAlign: 'center', marginBottom: 14 }}>
            首答对 {rightN}/{noPeek.length} 题
            {recs.filter(r => r.peek).length > 0 && ` · 看答案 ${recs.filter(r => r.peek).length} 题（不计分）`}
          </div>

          <div className="v4kpis">
            <div className="v4kpi">
              <div className="v" style={{ color: gate.timeOk ? 'var(--ok)' : 'var(--bad)' }}>
                {fmtSec(snap.effSec)}
              </div>
              <div className="l">有效 / {fmtSec(minSec)}</div>
            </div>
            <div className="v4kpi">
              <div className="v" style={{ color: gate.mustOk ? 'var(--ok)' : 'var(--bad)' }}>
                {mustDone}/{mustAll}
              </div>
              <div className="l">必做</div>
            </div>
            <div className="v4kpi">
              <div className="v">{fmtSec(snap.idleSec)}</div>
              <div className="l">空闲</div>
            </div>
            <div className="v4kpi">
              <div className="v">{recs.length}</div>
              <div className="l">总作答</div>
            </div>
          </div>

          {!gate.done && (
            <div className="v4note bad">
              <b>{gate.note}</b>
              {!gate.timeOk && <div style={{ marginTop: 4 }}>挂机的时间不算有效学习，只有连续操作才算。</div>}
            </div>
          )}
          {peekRate > 0.4 && (
            <div className="v4note bad">看答案超过 40%，今天不算完成。看答案的题不计分，也不进掌握了。</div>
          )}
          {capped && (
            <div className="v4note">
              到 {plan.maxMin} 分钟封顶了，今天就收在这儿。慢慢做不会让作业变多，只会让做得快的部分被拖长。
            </div>
          )}

          {wrongList.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="sub small" style={{ marginBottom: 6 }}>今天错的 {wrongList.length} 个词（已进错词本）</div>
              <div className="v4wrongs">
                {wrongList.map(w => (
                  <span key={w} className="v4wrong" onClick={() => playWordText(w)}>{w}</span>
                ))}
              </div>
            </div>
          )}

          {/* 战报（v5）：存长图 / 复制文字。微信里 a[download] 基本失效，所以出图给他长按保存 */}
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => {
              const rd = buildReport(progRef.current, plan, recs, day)
              try { setPoster(reportImage(rd)) } catch { setPoster('') }
            }}>存长图（发微信）</button>
            <button className="btn ghost" style={{ flex: 1 }} onClick={async () => {
              const rd = buildReport(progRef.current, plan, recs, day)
              const txt = reportText(rd)
              try {
                await navigator.clipboard.writeText(txt)
                setCopied('已复制，直接粘到微信')
              } catch {
                setCopied(txt)
              }
            }}>复制文字</button>
          </div>
          {poster && (
            <div style={{ marginTop: 12 }}>
              <img src={poster} alt="今日战报" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />
              <div className="sub small" style={{ textAlign: 'center', marginTop: 6 }}>长按图片保存，发微信时选「原图」</div>
            </div>
          )}
          {copied && (
            <div className="v4note" style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{copied}</div>
          )}

          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            {gate.done ? (
              <>
                {gateNext && (
                  <button className="btn" style={{ flex: 1.3 }} onClick={() => nav('/gate/' + gateNext.unit)}>
                    去考{unitName(gateNext.unit)}
                  </button>
                )}
                <button className="btn" style={{ flex: 1 }} onClick={() => nav('/')}>回首页</button>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => nav('/review')}>看错词本</button>
              </>
            ) : (
              <>
                <button className="btn" style={{ flex: 1.4 }} onClick={() => addDrill(Math.max(8, Math.ceil(restSec / 25) * 2 || 8))}>
                  {restSec > 0
                    ? `继续补 ${Math.min(10, Math.max(1, Math.ceil(restSec / 60)))} 分钟`
                    : `补 ${gate.needQ} 题`}
                </button>
                <button className="btn ghost" style={{ flex: 0.8 }} onClick={() => nav('/')}>先退出</button>
              </>
            )}
          </div>
          {!gate.done && (
            <div className="sub small" style={{ marginTop: 10, textAlign: 'center' }}>
              没到 {plan.minMin} 分钟不给星、不算打卡，明天首页会提示补上。
            </div>
          )}
        </div>
      </Shell>
    )
  }

  /* ── 答题中 ── */
  return (
    <Shell title="今天" noNav right={
      <button className="iconbtn" onClick={() => setPhase('wrap')} aria-label="结束">结束</button>
    }>
      {/* 三格面板：恒定可见，任何时候都知道还差多少 */}
      <div className="v4panel">
        <div className="v4pg">
          <div className="v4pv">{fmtSec(snap.effSec)}<span>/{fmtSec(minSec)}</span></div>
          <div className="v4pl">有效学习时间</div>
          <div className="v4bar"><i style={{ width: timePct + '%', background: timePct >= 100 ? 'var(--ok)' : 'var(--blue)' }} /></div>
        </div>
        <div className="v4pg">
          <div className="v4pv">{mustDone}<span>/{mustAll}</span></div>
          <div className="v4pl">必做</div>
          <div className="v4bar"><i style={{ width: mustPct + '%', background: mustPct >= 100 ? 'var(--ok)' : 'var(--gold)' }} /></div>
        </div>
        <div className="v4pg">
          <div className="v4pv" style={{ color: snap.effSec >= minSec ? 'var(--ok)' : 'var(--ink)' }}>
            {snap.effSec >= minSec ? '已达标' : `差 ${Math.ceil((minSec - snap.effSec) / 60)}′`}
          </div>
          <div className="v4pl">距下限</div>
        </div>
      </div>

      {/* 段进度条 */}
      <div className="v4segs">
        {segs.map((s, i) => {
          const cur = q && q.seg === i
          const done = q ? i < q.seg : true
          return (
            <span key={i} className={'v4sd' + (done ? ' done' : '') + (cur ? ' cur' : '')}
              title={s.label}>{s.k === 'wrap' ? '结' : i + 1}</span>
          )
        })}
      </div>

      {curSeg && (
        <div className="v4seghd">
          <span>第 {q!.seg + 1} 段 · {curSeg.label}</span>
          <span className="sub small">{qi + 1}/{bank.qs.length}</span>
        </div>
      )}

      {/* ── 题卡 ── */}
      <div className="card pad v4q">
        {q?.kind === 'flash' && (
          <div className="v4center">
            <div className="v4prompt">听一遍，看一遍</div>
            <div className="v4word" onClick={() => void play(q)}>{q.word}</div>
            <div className="v4cnMini">{q.cn}</div>
            <button className="btn" onClick={() => { timer.current?.tap(); next() }}>下一个</button>
          </div>
        )}

        {q?.kind === 'teach' && (
          <div className="v4center">
            <div className="v4prompt">新词 · 先记住</div>
            <button className="v4play" onClick={() => void play(q)}>🔊 点我读一遍</button>
            <div className="v4word">{q.word}</div>
            <div className="v4syl">{syllableText(q.word)}</div>
            {taught ? (
              <div className="v4teachcn">{q.cn}</div>
            ) : (
              <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => setTaught(true)}>看意思</button>
            )}
            <button className="btn" style={{ marginTop: 14 }} disabled={!taught}
              onClick={() => { timer.current?.tap(); next() }}>
              {taught ? '记住了，下一个' : '先看意思'}
            </button>
          </div>
        )}

        {q?.kind === 'pick' && (
          <div>
            <div className="v4prompt" style={{ textAlign: 'center' }}>听发音，选意思</div>
            <button className="v4play" onClick={() => void play(q)}>🔊 再听一遍</button>
            <div className="v4opts">
              {choiceOrder.map(o => (
                <button key={o.key}
                  className={'v4opt' + (sel === o.key ? ' sel' : '')
                    + (verdict && sel === o.key ? (verdict === 'ok' ? ' ok' : ' bad') : '')}
                  disabled={!!verdict}
                  onClick={() => { if (!verdict) { timer.current?.tap(); setSel(o.key) } }}>
                  {o.text}
                </button>
              ))}
            </div>
            {!verdict && (
              <button className="btn" style={{ marginTop: 14 }} disabled={!sel}
                onClick={() => {
                  const ok = sel === q.answerKey
                  setVerdict(ok ? 'ok' : 'bad')
                  grade(ok, { hinted: tries > 0 })
                  if (ok) {
                    window.setTimeout(() => next(), 520)
                  } else {
                    setTries(t => t + 1)
                  }
                }}>
                {sel ? '确定' : '先选一个'}
              </button>
            )}
            {verdict === 'bad' && (
              <div className="v4note bad" style={{ marginTop: 12 }}>
                {peeked ? <>看过了：<b>{q.cn}</b>。</> : <>这个不对。<b>{q.cn}</b> 才是它的意思。</>}
                {peeked ? (
                  // 看答案的题已扣分母、S 归 1、进错词本，没必要再重做一遍——
                  // 让他重做只会变成「照着答案点一遍」，纯浪费时间
                  <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
                ) : tries >= 2 ? (
                  // 错满两次放行：再憋着只会让他乱点，分数早就按首答记过了
                  <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
                ) : (
                  <button className="btn ghost" style={{ marginTop: 8 }}
                    onClick={() => {
                      // 答错必重做：换乱序再来一次（分数已按首答记过）
                      setChoiceOrder(o => [...o].sort(() => Math.random() - 0.5))
                      setSel(null); setVerdict('')
                    }}>
                    重新选
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {q?.kind === 'spell' && (
          <div>
            <div className="v4prompt" style={{ textAlign: 'center' }}>
              {showCn ? q.cn : (
                <button className="btn ghost" onClick={() => { timer.current?.tap(); setShowCn(true) }}>
                  点这里看中文
                </button>
              )}
            </div>
            <button className="v4play" onClick={() => void play(q)}>🔊 再听一遍</button>
            <div className="v4hint">{q.hint}<span className="sub small"> · {q.len} 个字母</span></div>
            <input className="v4input" value={input} readOnly inputMode="none"
              onChange={e => setInput(e.target.value)}
              placeholder="在这里拼出来" />
            {verdict === '' && (
              <LetterKeyboard
                onKey={ch => { timer.current?.tap(); setInput(v => v + ch) }}
                onBackspace={() => setInput(v => v.slice(0, -1))}
                onSubmit={() => {
                  if (!input.trim()) return
                  const ok = judgeWithFirst(input, q.word) || judge(input, q.word)
                  setVerdict(ok ? 'ok' : 'bad')
                  grade(ok, { hinted: showCn || tries > 0 })
                  setInput('')
                  if (ok) window.setTimeout(() => next(), 420)
                  else setTries(t => t + 1)
                }}
              />
            )}
            {verdict === 'bad' && peeked && (
              <div className="v4note bad" style={{ marginTop: 10 }}>
                看过了：<b className="v4ans">{q.word}</b>
                <div className="sub small" style={{ marginTop: 4 }}>{q.cn}</div>
                <button className="btn" style={{ marginTop: 10 }} onClick={() => next()}>下一个 →</button>
              </div>
            )}
            {verdict === 'bad' && !peeked && (
              <div className="v4note bad" style={{ marginTop: 10 }}>
                正确拼写是 <b className="v4ans">{q.word}</b>
                <div className="sub small" style={{ marginTop: 4 }}>照着抄一遍，抄对就过（分数已按第一次记）</div>
                <input className="v4input" value={input} inputMode="none" readOnly
                  onChange={e => setInput(e.target.value)} placeholder="照着抄一遍" />
                <LetterKeyboard
                  onKey={ch => { timer.current?.tap(); setInput(v => v + ch) }}
                  onBackspace={() => setInput(v => v.slice(0, -1))}
                  onSubmit={() => {
                    if (judge(input, q.word) || judgeWithFirst(input, q.word)) next()
                    else setInput('')
                  }}
                />
                <button className="btn ghost" style={{ marginTop: 8 }}
                  onClick={() => {
                    // 抄写必须校验：抄错了说明根本没看，让他重抄（这不是惩罚，是覆盖错误记忆）
                    if (judge(input, q.word) || judgeWithFirst(input, q.word)) next()
                    else setInput('')
                  }}>抄完了</button>
              </div>
            )}
          </div>
        )}

        {q?.kind === 'sent' && (
          <div>
            <div className="v4prompt" style={{ textAlign: 'center' }}>把这个句子拼出来</div>
            <div className="v4sentcn">{q.cn}</div>
            <div className="v4slot">
              {picked.map((p, i) => (
                <button key={p.idx} className="v4tok on"
                  onClick={() => {
                    timer.current?.tap()
                    setPicked(x => x.filter((_, j) => j !== i))
                    setPool(x => [...x, p.idx])
                  }}>{p.text}</button>
              ))}
              {!picked.length && <span className="sub small">按顺序点下面的词块</span>}
            </div>
            <div className="v4toks">
              {pool.map(idx => (
                <button key={idx} className="v4tok"
                  onClick={() => {
                    timer.current?.tap()
                    setPicked(p => [...p, { idx, text: q.tokens![idx] }])
                    setPool(p => p.filter(x => x !== idx))
                  }}>{q.tokens![idx]}</button>
              ))}
            </div>
            {verdict === '' ? (
              <button className="btn" style={{ marginTop: 12 }} disabled={pool.some(x => x >= 0)}
                onClick={() => {
                  const ok = judgeSentence(picked.map(x => x.text), q.tokens!)
                  setVerdict(ok ? 'ok' : 'bad')
                  grade(ok, { hinted: tries > 0 })
                  if (ok) window.setTimeout(() => next(), 500)
                  else setTries(t => t + 1)
                }}>
                {pool.some(x => x >= 0) ? '还有词块没用完' : '确定'}
              </button>
            ) : verdict === 'bad' ? (
              <div className="v4note bad" style={{ marginTop: 10 }}>
                正确句子：<b>{q.en}</b>
                {q.tip && <div className="sub small" style={{ marginTop: 4 }}>{q.tip}</div>}
                {peeked || tries >= 2 ? (
                  // 拼两次还不对就放行——句子是 5-8 个词块，卡在这里最容易让人摔手机
                  <button className="btn" style={{ marginTop: 8 }} onClick={() => next()}>下一个 →</button>
                ) : (
                  <button className="btn ghost" style={{ marginTop: 8 }}
                    onClick={() => { setPicked([]); setPool(q.order ? q.order.slice() : q.tokens!.map((_, i) => i)); setVerdict('') }}>
                    再拼一次
                  </button>
                )}
              </div>
            ) : (
              <div className="v4note ok" style={{ marginTop: 10 }}>拼对了。{q.tip}</div>
            )}
          </div>
        )}

        {q?.kind === 'paper' && (
          <div className="v4center">
            <div className="v4prompt">写在听写本上（这题要动笔）</div>
            <div className="v4play" onClick={() => void play(q)} style={{ cursor: 'pointer' }}>🔊 听发音</div>
            <div className="v4teachcn">{q.cn}</div>
            <div className="sub small" style={{ marginTop: 6 }}>写完再点下面，别偷看手机</div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => {
                timer.current?.tap(); grade(true); next()
              }}>写对了</button>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => {
                timer.current?.tap(); grade(false); next()
              }}>没写出来</button>
            </div>
          </div>
        )}
      </div>

      {/* 不会就看答案：扣分母、进错词本、S 归 1 */}
      {q && q.kind !== 'flash' && q.kind !== 'teach' && q.kind !== 'paper' && !verdict && (
        <button className="v4peek" onClick={() => {
          setPeeked(true)
          grade(false, { peek: true })
          setVerdict('bad')
          setTries(t => t + 1)
        }}>
          不会，看答案（不计分）
        </button>
      )}
    </Shell>
  )
}
