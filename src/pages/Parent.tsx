import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import PinGate from '../components/PinGate'
import { useStore, applyRules } from '../lib/store'
import { markRevertOwner, clearRevertOwner } from '../lib/storage'
import {
  fetchStats, checkBackend, fetchPinStatus, setParentPin, fetchPapers, paperFileUrl,
  createShare, rotateShuffleSalt, pushShuffleMode, currentShuffleMode, fetchShuffleSalt,
  fetchRecordings, recordFileUrl, fetchSessionDetail,
  fetchWordbooks, currentBooks, pushActiveBook, pushDailyWords, createWordbook, deleteWordbook,
  fetchParentRules, pushParentRules,
  type StatsResp, type PhotoItem, type RecItem, type BooksResp, type ParentRules,
  type SessionDetail,
} from '../lib/api'
import { getPlanTrack } from '../lib/data'
import { todayStr, load, weekStartStr } from '../lib/storage'
import { sharePoster, weekPoster } from '../lib/poster'
import { calcWeekReport } from '../lib/weekreport'
import { pullAndMerge } from '../lib/sync'

type Range = 'day' | 'week' | 'month'
type Tab = 'board' | 'admin'
type ShuffleModeUi = 'daily' | 'weekly' | 'manual'
const modeLabel: Record<ShuffleModeUi, string> = { daily: '每天换', weekly: '每周换', manual: '家长手动' }
const prepLabel: Record<string, string> = { recommended: '推荐 · 可跳过', force: '必须先学', off: '直接听写' }
const prepDesc: Record<string, string> = {
  recommended: '听写前先过一遍今天的词（自动发音的卡片），孩子觉得熟了可以自己点「直接听写」跳过。',
  force: '不学完不放开听写入口，适合新单元第一遍。',
  off: '不显示预习环节，进来直接听写。',
}

/** 秒数 → 「3分20秒」 */
function fmtSec(sec: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m >= 1) return s ? `${m}分${s}秒` : `${m}分`
  return `${s}秒`
}

/** 毫秒时间戳 → 「今天 14:32」 / 「10/2 08:05」（北京时间按设备本地时区显示） */
function fmtWhen(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (todayStr(d) === todayStr(new Date())) return `今天 ${t}`
  return `${d.getMonth() + 1}/${d.getDate()} ${t}`
}

/**
 * 家长中心（v2.8 起 Tab 化）：
 * - 学习看板：进度数据 + 照片 + 跟读 + 分享，进来就能看。
 * - 管理设置：所有「管控类」设置收归这里（过家长解锁码才能进），
 *   保存后推到云端，所有设备（孩子的手机/电脑）自动生效。
 * 数据来自 Cloudflare D1（后端），后端不通时降级为本地数据 + 明确提示。
 */
export default function Parent() {
  const nav = useNavigate()
  const { profiles, profile, progress, switchProfile, updateSettings } = useStore()
  const [tab, setTab] = useState<Tab>('board')
  const [range, setRange] = useState<Range>('week')
  const [stats, setStats] = useState<StatsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState<boolean | null>(null)

  /* ── v3.3.2 身份隔离：家长切人看板不改设备归属 ──
     家长切到另一个孩子查看 → 离开家长中心时自动切回进页时的身份，
     设备主人（deviceOwner）也随之还原。否则家长看完弟弟，
     哥哥再打开应用看到的是弟弟的数据，还被记成弟弟。
     切换瞬间会落盘回切标记（markRevertOwner）：若家长中途直接关
     浏览器、这段自动切回来不及跑，下次启动 consumeRevertOwner 兜底恢复。 */
  const enterIdRef = useRef(profile.id)
  const curIdRef = useRef(profile.id)
  curIdRef.current = profile.id
  useEffect(() => () => {
    if (curIdRef.current !== enterIdRef.current) switchProfile(enterIdRef.current)
    clearRevertOwner()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 家长解锁码 ── */
  const [pinExists, setPinExists] = useState<boolean | null>(null)
  const [oldPin, setOldPin] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinMsg, setPinMsg] = useState('')

  /* ── 纸质卷照片 ── */
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null)
  // v3.2：默认展开「今天」的组（家长最关心的就是当天的卷子）；点其他天时覆盖
  const [openDay, setOpenDay] = useState<string | null>(() => todayStr())

  /* ── 会话逐题明细（v3.2：最近听写点开看对错） ── */
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  /* ── 跟读录音 ── */
  const [recs, setRecs] = useState<RecItem[] | null>(null)
  const [openRecDay, setOpenRecDay] = useState<string | null>(null)

  /* ── 出题顺序 / 分享 ── */
  const [mode, setMode] = useState<ShuffleModeUi>(() => currentShuffleMode())
  const [rotMsg, setRotMsg] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareMsg, setShareMsg] = useState('')

  /* ── 管控规则（v2.8）：云端拉取 + 全量保存 ── */
  const [rules, setRules] = useState<ParentRules>({})
  const [rulesLoaded, setRulesLoaded] = useState(false)
  const [rulesMsg, setRulesMsg] = useState('')
  const [msgText, setMsgText] = useState('')
  const [examDateText, setExamDateText] = useState('')

  /* ── 本周速览（v3.0）：独立于看板档位，始终显示本周大盘 ── */
  const [weekStats, setWeekStats] = useState<StatsResp | null>(null)

  /* ── 导出备份（v3.0） ── */
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    checkBackend().then(alive => {
      if (cancel) return
      setOnline(alive)
      if (!alive) { setLoading(false); return }
      fetchStats(profile.id, range, 30).then(s => {
        if (cancel) return
        setStats(s)
        setLoading(false)
      })
    })
    return () => { cancel = true }
  }, [profile.id, range])

  // 解锁码状态 + 照片列表
  useEffect(() => {
    let cancel = false
    fetchPinStatus().then(r => { if (!cancel) setPinExists(!!r?.exists) }).catch(() => { if (!cancel) setPinExists(null) })
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (online !== true) return
    let cancel = false
    fetchPapers(profile.id).then(list => { if (!cancel) setPhotos(list) })
    fetchRecordings(profile.id).then(list => { if (!cancel) setRecs(list) })
    return () => { cancel = true }
  }, [online, profile.id])

  // 本周速览：独立拉一周统计，看板档位切到「今天/本月」也看得见本周大盘
  useEffect(() => {
    if (online !== true) return
    let cancel = false
    fetchStats(profile.id, 'week', 30)
      .then(s => { if (!cancel) setWeekStats(s) })
      .catch(() => {})
    return () => { cancel = true }
  }, [online, profile.id])

  // 进页面时以云端为准刷新顺序模式（可能在别的设备上切过档）
  useEffect(() => {
    let cancel = false
    fetchShuffleSalt().finally(() => { if (!cancel) setMode(currentShuffleMode()) })
    return () => { cancel = true }
  }, [])

  // 拉管控规则（寄语输入框也等这个回来再初始化，防止空值覆盖）
  useEffect(() => {
    let cancel = false
    fetchParentRules().then(r => {
      if (cancel) return
      setRules(r)
      setMsgText(r.parentMessage || '')
      setExamDateText(r.examDate || '')
      setRulesLoaded(true)
    }).catch(() => { if (!cancel) setRulesLoaded(false) })
    return () => { cancel = true }
  }, [])

  /** 保存管控规则：全量推云端（后端是整体替换）+ 本机即时生效 */
  const saveRules = async (patch: ParentRules) => {
    if (!rulesLoaded) { setRulesMsg('规则还在加载，等一秒再试'); return }
    const merged = { ...rules, ...patch }
    setRules(merged)
    // 本机先生效（家长自己手机上马上能看到效果）
    updateSettings(applyRules(merged))
    const okRes = await pushParentRules(merged)
    setRulesMsg(okRes
      ? '已保存：孩子的所有设备会自动生效'
      : '云端没连上，只在本机生效了；连上后记得回来再存一次')
  }

  /** 切换顺序模式：本地立刻变 + 推到云端（所有设备生效） */
  const switchMode = async (m: ShuffleModeUi) => {
    setMode(m)
    const okRes = await pushShuffleMode(m)
    setRotMsg(okRes
      ? `已切换：所有设备的出题顺序按「${modeLabel[m]}」生效`
      : '云端没连上，本机已切换，其他设备暂时看不到')
  }

  const rotate = async () => {
    setRotMsg('重排中…')
    const s = await rotateShuffleSalt()
    setRotMsg(s
      ? '已重排：三种模式下都立刻生效，所有设备、所有天的题目顺序全部刷新（当天纸质卷跟着变）'
      : '重排失败：网络不通，稍后再试')
  }

  const savePin = async () => {
    if (!/^\d{4,6}$/.test(pin1)) { setPinMsg('必须是 4-6 位数字'); return }
    if (pin1 !== pin2) { setPinMsg('两次输入不一致'); return }
    const r = await setParentPin(pin1, oldPin || undefined)
    if (r.ok) {
      setPin1(''); setPin2(''); setOldPin(''); setPinExists(true)
      setPinMsg('已保存。以后打开「答案版」、「纸质批改」和「管理设置」都要输这个码')
    } else {
      setPinMsg(r.msg)
    }
  }

  /** 生成只读分享链接：对错统计 + 高频错词 + 最近的纸质卷照片 + 跟读录音 */
  /** 导出备份 JSON：先以云端为准合并拿最新并集；云端不通就导本地进度 */
  const exportBackup = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const merged = await pullAndMerge(profile.id).catch(() => null)
      const data = merged || load(profile.id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `听写备份_${profile.name}_${todayStr()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const makeShare = async () => {
    setShareMsg('生成中…')
    const url = await createShare({
      v: 1,
      studentName: profile.name,
      emoji: profile.emoji,
      title: `家长看板 · ${rangeLabel[range]}`,
      date: todayStr(),
      score: S.acc,
      sessions: S.sessions,
      total: S.total,
      right: S.right,
      wrongs: (stats?.topWrong || []).slice(0, 12).map(w => ({ word: w.word, cn: w.cn })),
      // v3.2：分享页照片只带「今天」拍的（key 第三段是 dayKey）。
      // 之前不筛日期，当天没拍照就拿几天前的旧照片顶数，家人看到的卷子和成绩对不上。
      // 当天没照片就空着——宁可没有，不能用旧的冒充。
      photoKeys: (photos || []).filter(p => (p.key.split('/')[2] || '') === todayStr()).slice(0, 6).map(p => p.key),
      recordKeys: (recs || []).slice(0, 12).map(r => {
        // key: records/{sid}/{dayKey}/{trackId}/{no}-{word}-{uid}.{ext}
        const seg = r.key.split('/')
        const raw = (seg[4] || '').replace(/^\d{2}-/, '').replace(/-[a-z0-9]+\.\w+$/i, '')
        return { word: raw, cn: '', key: r.key }
      }),
    })
    if (!url) { setShareMsg('生成失败：网络不通'); return }
    setShareUrl(url)
    try {
      await navigator.clipboard.writeText(url)
      setShareMsg('链接已复制，去微信粘贴发送即可。家人点开就能看对错、纸质照片和跟读录音。')
    } catch {
      setShareMsg('链接已生成，长按复制下面这段地址发到微信：')
    }
  }

  /** 展开/收起某次听写的逐题明细（v3.2）。同一条再点一次收起 */
  const toggleDetail = async (id: string) => {
    if (detailId === id) { setDetailId(null); setDetail(null); return }
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    const d = await fetchSessionDetail(id)
    setDetail(d)
    setDetailLoading(false)
  }

  // 照片按天分组（key 格式 papers/{sid}/{dayKey}/{uid}.ext）
  const photoGroups = useMemo(() => {
    const m: Record<string, PhotoItem[]> = {}
    for (const p of photos || []) {
      const day = p.key.split('/')[2] || '未知日期'
      ;(m[day] ||= []).push(p)
    }
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]))
  }, [photos])

  // 录音按天分组（key 格式 records/{sid}/{dayKey}/{trackId}/{no}-{word}-{uid}.ext）
  const recGroups = useMemo(() => {
    const m: Record<string, { word: string; key: string }[]> = {}
    for (const r of recs || []) {
      const day = r.key.split('/')[2] || '未知日期'
      const seg = r.key.split('/')
      const raw = (seg[4] || '').replace(/^\d{2}-/, '').replace(/-[a-z0-9]+\.\w+$/i, '')
      ;(m[day] ||= []).push({ word: raw, key: r.key })
    }
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]))
  }, [recs])

  const shuffleMode = mode

  const s = stats?.summary

  // 本地兜底数据
  const local = useMemo(() => {
    const hist = progress.history || []
    const total = hist.reduce((a, h) => a + h.total, 0)
    const right = hist.reduce((a, h) => a + h.right, 0)
    return {
      sessions: hist.length,
      total,
      right,
      acc: total ? Math.round((right / total) * 100) : 0,
      totalDays: Object.keys(progress.minutes || {}).length,
      streak: progress.streakDays,
    }
  }, [progress])

  const useLocal = online === false
  const S = useLocal ? local : {
    sessions: s?.sessions || 0,
    total: s?.total || 0,
    right: s?.right || 0,
    acc: s?.acc || 0,
    totalDays: s?.totalDays || 0,
    streak: s?.streak || 0,
  }

  const rangeLabel: Record<Range, string> = { day: '今天', week: '本周', month: '本月' }

  return (
    <Shell title="家长中心" back sub={useLocal ? '本地数据' : '云端同步'}>
      {/* 后端状态提示 */}
      {useLocal && (
        <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: '#f0d69a' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>⚠️ 云端未连接，当前显示本机数据</div>
          <div className="sub small" style={{ marginTop: 4, lineHeight: 1.7 }}>
            本机数据只包含这台设备做过的练习。连上云端后，孩子在任意设备上的练习都会汇总到这里。
          </div>
        </div>
      )}

      {/* 主 Tab：学习看板 / 管理设置 */}
      <div className="seg" style={{ marginBottom: 14, width: '100%' }}>
        <button className={tab === 'board' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab('board')}>
          📱 学习看板
        </button>
        <button className={tab === 'admin' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab('admin')}>
          ⚙️ 管理设置
        </button>
      </div>

      {/* ══════════ 学习看板 ══════════ */}
      {tab === 'board' && (
        <>
          {/* 每周报告（v3.4）：本周 vs 上周，只和自己比；一键海报发微信 */}
          {(() => {
            const rep = calcWeekReport(progress)
            const tw = rep.thisWeek
            return (
              <div className="card pad" style={{ marginBottom: 14, borderColor: '#d0c4f5', background: 'linear-gradient(180deg,#f8f6ff,#fff)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>📋 本周报告 · 只和自己比</div>
                  <div className="sub small">{weekStartStr()} ~ {todayStr()}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
                  <div style={{ fontSize: 40, fontWeight: 800, color: tw.acc === null ? 'var(--sub)' : tw.acc >= 70 ? 'var(--ok)' : '#e03131' }}>
                    {tw.acc === null ? '—' : `${tw.acc}%`}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: rep.accDelta === null ? 'var(--sub)' : rep.accDelta >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                    {rep.accDelta === null ? '上周无数据' : `${rep.accDelta >= 0 ? '▲' : '▼'} ${Math.abs(rep.accDelta)}%`}
                  </div>
                  <div className="sub small" style={{ marginLeft: 'auto' }}>
                    练 {tw.days} 天 · {tw.sessions} 卷 · {tw.minutes} 分钟
                  </div>
                </div>
                {rep.passedUnits.length > 0 && (
                  <div className="sub small" style={{ marginTop: 8, color: 'var(--ok)', fontWeight: 700 }}>
                    🏅 本周过关：{rep.passedUnits.map(p => `${p.unit.replace('unit', 'Unit ')} ${p.score}分`).join(' · ')}
                  </div>
                )}
                {rep.newWrongs.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.9 }}>
                    <span className="sub" style={{ fontWeight: 700 }}>新增错词：</span>
                    {rep.newWrongs.map(w => `${w.word}(${w.count})`).join('、')}
                  </div>
                )}
                <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
                  📌 {rep.advice}
                </div>
                <button className="btn sm" style={{ marginTop: 10, width: '100%', background: '#5f3dc4' }} onClick={() => void weekPoster({
                  profile,
                  dateRange: `${weekStartStr()}~${todayStr()}`,
                  acc: tw.acc,
                  accDelta: rep.accDelta,
                  days: tw.days,
                  sessions: tw.sessions,
                  minutes: tw.minutes,
                  newWrongs: rep.newWrongs,
                  passedUnits: rep.passedUnits,
                  advice: rep.advice,
                })}>🖼️ 生成海报 · 发微信存档</button>
              </div>
            )
          })()}

          {/* 本周速览（v3.0）：不跟档位走，打开就能看到本周大盘 */}
          {weekStats && weekStats.summary.sessions > 0 && (() => {
            const w = weekStats.summary
            return (
              <div className="card pad" style={{ marginBottom: 14, background: 'linear-gradient(180deg,#f4f8ff,#fff)', borderColor: '#c9dbf5' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>📅 本周速览</div>
                  <div className="sub small">周一至今 · 云端</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{w.sessions}</div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>次听写</div>
                  </div>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{Math.round(w.acc)}%</div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>正确率</div>
                  </div>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{fmtSec(w.seconds) || '0秒'}</div>
                    <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>累计用时</div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 周期切换 */}
          <div className="seg" style={{ marginBottom: 14, width: '100%' }}>
            {(['day', 'week', 'month'] as Range[]).map(r => (
              <button key={r} className={range === r ? 'on' : ''} style={{ flex: 1 }}
                onClick={() => setRange(r)}>
                {rangeLabel[r]}
              </button>
            ))}
          </div>

          {/* 周期总览 */}
          <div className="hero">
            <div className="lv">{profile.emoji} {profile.name} · {rangeLabel[range]}</div>
            <div className="nm">{S.acc}% 正确率</div>
            <div className="meta" style={{ marginTop: 10 }}>
              <div><b>{S.sessions}</b>次听写</div>
              <div><b>{S.total}</b>道题</div>
              <div><b>{S.totalDays}</b>总天数</div>
              <div><b>{S.streak}</b>连续</div>
            </div>
          </div>

          {/* 今日三格打卡（v2.7）：预习 / 听写 / 手写照片 */}
          {!loading && (() => {
            const today = todayStr()
            const learnedToday = Object.values(progress.learned || {})
              .some(l => todayStr(new Date(l.at)) === today)
            const dictToday = (progress.history || [])
              .some(h => todayStr(new Date(h.at)) === today)
            const photoToday = (photos || []).some(p => p.key.includes('/' + today + '/'))
            const done = [learnedToday, dictToday, photoToday]
            return (
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  ✅ 今天的完成情况
                  {done.every(Boolean) && <span style={{ color: 'var(--ok)', marginLeft: 8 }}>三格全齐 +10 积分 🎉</span>}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className={'pill ' + (learnedToday ? 'p-ok' : 'p-bad')} style={{ fontSize: 13, padding: '6px 12px' }}>
                    📖 预习 {learnedToday ? '✓' : '未做'}
                  </span>
                  <span className={'pill ' + (dictToday ? 'p-ok' : 'p-bad')} style={{ fontSize: 13, padding: '6px 12px' }}>
                    🎧 听写 {dictToday ? '✓' : '未做'}
                  </span>
                  <span className={'pill ' + (photoToday ? 'p-ok' : 'p-bad')} style={{ fontSize: 13, padding: '6px 12px' }}>
                    📸 手写照片 {photoToday ? '✓' : '未传'}
                  </span>
                </div>
                <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                  预习和听写来自学习记录，照片以云端为准（孩子拍完手写本自动传上来，
                  分享链接里能看到）。预习那格「学过才算」，跳过预习不会亮。
                </div>
              </div>
            )
          })()}

          {/* 切换孩子（家长视角查看；离开本页自动切回进来的身份，不影响孩子使用） */}
          {profiles.length > 1 && (
            <div className="profileBar">
              <div className="pList">
                {profiles.map(p => (
                  <button key={p.id}
                    className={'pChip' + (p.id === profile.id ? ' on' : '')}
                    style={p.id === profile.id ? { borderColor: p.color, background: p.color + '14' } : {}}
                    onClick={() => {
                      if (p.id === profile.id) return
                      // 切换瞬间先落盘「该切回谁」：万一家长中途直接关浏览器，
                      // unmount 的自动切回跑不到，下次启动靠这个标记兜底恢复
                      markRevertOwner(enterIdRef.current)
                      switchProfile(p.id)
                    }}>
                    <span className="pe">{p.emoji}</span>
                    <span className="pn">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {profiles.length > 1 && (
            <div className="sub small" style={{ margin: '-4px 0 12px', lineHeight: 1.6 }}>
              这里切换只是家长查看，退出家长中心会自动切回「{profiles.find(p => p.id === enterIdRef.current)?.name}」，不影响孩子的设备归属。
            </div>
          )}

          {loading && <div className="card pad center sub">加载中…</div>}

          {/* 趋势图 */}
          {!loading && !useLocal && stats && stats.trend.length > 0 && (
            <div className="card pad">
              <div style={{ fontWeight: 800, marginBottom: 12 }}>📈 正确率趋势（近 {stats.trend.length} 天）</div>
              <TrendChart data={stats.trend} />
            </div>
          )}

          {/* 错词 TOP */}
          {!loading && !useLocal && stats && stats.topWrong.length > 0 && (
            <div className="card pad">
              <div style={{ fontWeight: 800, marginBottom: 4 }}>
                🎯 高频错词 TOP {stats.topWrong.length}
                <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>近 60 天</span>
              </div>
              <div className="reviewlist" style={{ marginTop: 8 }}>
                {stats.topWrong.map((w, i) => (
                  <div key={w.word} className="rv">
                    <span className="mk" style={{ color: 'var(--bad)' }}>{i + 1}</span>
                    <span className="w">{w.word}</span>
                    <span className="sub small">{w.cn}</span>
                    <span className="pill p-bad" style={{ marginLeft: 'auto' }}>错 {w.times} 次</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最近听写（v2.8 增强：用时 + 时段，家长能看出每次花了多久、什么时间做的） */}
          {!loading && !useLocal && stats && stats.recent.length > 0 && (
            <div className="card pad">
              <div style={{ fontWeight: 800, marginBottom: 4 }}>🕐 最近听写</div>
              {fmtSec(stats.summary.seconds) && (
                <div className="sub small" style={{ marginBottom: 8 }}>
                  本周期累计用时 {fmtSec(stats.summary.seconds)}
                </div>
              )}
              <div className="reviewlist">
                {stats.recent.slice(0, 12).map(r => {
                  const open = detailId === r.id
                  return (
                    <div key={r.id}>
                      <div className="rv" style={{ flexWrap: 'wrap', cursor: 'pointer' }}
                        onClick={() => void toggleDetail(r.id)}
                        title="点开看每道题的对错">
                        <span className="mk" style={{
                          color: r.score >= 90 ? 'var(--ok)' : r.score >= 60 ? 'var(--blue)' : 'var(--bad)',
                        }}>{r.score}%</span>
                        <span className="w" style={{ fontSize: 13 }}>{r.track_label}</span>
                        <span className="sub small">
                          {r.right_count}/{r.total}
                          {r.mode === 'paper' && ' · 纸质'}
                          {r.mode === 'exam' && ' · 模考'}
                        </span>
                        <span className="sub small" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          {fmtSec(r.seconds) && <span style={{ marginRight: 8 }}>⏱ {fmtSec(r.seconds)}</span>}
                          {fmtWhen(r.created_at)}
                        </span>
                        <span className="sub small" style={{ marginLeft: 4, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
                      </div>
                      {open && (
                        <div style={{ padding: '4px 0 10px 12px' }}>
                          {detailLoading ? (
                            <div className="sub small">加载明细…</div>
                          ) : detail && detail.session.id === r.id ? (
                            <div className="reviewlist">
                              {detail.records.map(rec => (
                                <div key={rec.seq} className="rv">
                                  <span className="mk" style={{ color: rec.correct ? 'var(--ok)' : 'var(--bad)' }}>
                                    {rec.correct ? '✓' : '✗'}
                                  </span>
                                  <span className="w">{rec.word}</span>
                                  {!rec.correct && rec.input && <span className="mine">{rec.input}</span>}
                                  <span className="sub small" style={{ marginLeft: 'auto', textAlign: 'right' }}>{rec.cn}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="sub small">明细加载失败（云端不通），稍后再点。</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                用时太长（超过 1 分钟 / 10 词）通常是词不熟；总分忽高忽低，多半是状态问题，别急着加量。
              </div>
            </div>
          )}

          {/* 空状态 */}
          {!loading && !useLocal && stats && stats.summary.total === 0 && (
            <div className="card pad center">
              <div style={{ fontSize: 34 }}>📊</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>这个周期还没有记录</div>
              <div className="sub small" style={{ marginTop: 4 }}>让孩子做一次听写，这里就有数据了</div>
            </div>
          )}

          {/* 纸质卷照片 */}
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>📷 纸质卷照片</div>
            {!photos && <div className="sub small">云端未连接，照片看不了（本机拍照批改不受影响）</div>}
            {photos && photoGroups.length === 0 && (
              <div className="sub small">还没有照片。在「纸质批改」页拍照后会自动存到这里。</div>
            )}
            {photoGroups.map(([day, list]) => {
              const open = openDay === day
              return (
                <div key={day} style={{ marginBottom: 12 }}>
                  <div className="between" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {day}{day === todayStr() && <span className="pill p-ok" style={{ marginLeft: 6, fontSize: 11 }}>今天</span>}
                      <span className="sub small" style={{ marginLeft: 6 }}>· {list.length} 张</span>
                    </div>
                    <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => setOpenDay(open ? null : day)}>
                      {open ? '收起' : (list.length > 4 ? `展开全部 ${list.length} 张` : '展开')}
                    </button>
                  </div>
                  <div className="photoGrid">
                    {(open ? list : list.slice(0, 4)).map(p => (
                      <a key={p.key} href={paperFileUrl(p.key)} target="_blank" rel="noreferrer">
                        <img src={paperFileUrl(p.key)} alt={`纸质卷 ${day}`} loading="lazy" />
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 跟读录音 */}
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🎙️ 跟读录音</div>
            {!recs && <div className="sub small">云端未连接，录音看不了</div>}
            {recs && recGroups.length === 0 && (
              <div className="sub small">还没有录音。在「跟读录音」页录完并上传后会存到这里，也可以通过分享链接直接听。</div>
            )}
            {recGroups.map(([day, list]) => {
              const open = openRecDay === day
              return (
                <div key={day} style={{ marginBottom: 12 }}>
                  <div className="between" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{day} <span className="sub small">· {list.length} 条</span></div>
                    <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => setOpenRecDay(open ? null : day)}>
                      {open ? '收起' : (list.length > 4 ? `展开全部 ${list.length} 条` : '展开')}
                    </button>
                  </div>
                  <div className="reviewlist">
                    {(open ? list : list.slice(0, 4)).map(r => (
                      <div key={r.key} className="rv" style={{ flexWrap: 'wrap' }}>
                        <span className="w" style={{ minWidth: 72 }}>{r.word}</span>
                        <audio controls preload="none" src={recordFileUrl(r.key)}
                          style={{ height: 34, marginLeft: 'auto', maxWidth: '100%' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 分享 */}
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🔗 分享给家人（微信直接发链接）</div>
            <div className="sub small" style={{ marginBottom: 10, lineHeight: 1.7 }}>
              生成一条只读链接：点开就是 {profile.name} 的对错统计、高频错词和最近的纸质卷照片，不用截图。
            </div>
            <button className="btn" style={{ background: '#07c160' }} onClick={makeShare}>生成分享链接</button>
            {shareMsg && <div className="sub small" style={{ marginTop: 8, color: 'var(--blue)', fontWeight: 600, lineHeight: 1.7 }}>{shareMsg}</div>}
            {shareUrl && shareMsg.startsWith('链接已生成') && (
              <div className="tip" style={{ marginTop: 8, wordBreak: 'break-all', userSelect: 'all' }}>{shareUrl}</div>
            )}
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={() => location.reload()}>🔄 刷新数据</button>
            <button className="btn ghost" onClick={exportBackup} disabled={exporting}>
              {exporting ? '⏳ 导出中…' : '⬇️ 导出备份'}
            </button>
            <button className="btn" style={{ background: '#07c160' }} onClick={() => {
              const acc = S.acc
              sharePoster({
                profile,
                trackLabel: `家长看板 · ${rangeLabel[range]}`,
                date: new Date().toISOString().slice(0, 10),
                score: acc, right: S.right, total: S.total, seconds: 0,
                answers: (stats?.topWrong || []).slice(0, 10).map(w => ({
                  word: w.word, cn: w.cn, correct: false, input: '',
                })),
              })
            }}>
              📤 生成周报图（发微信）
            </button>
          </div>

          <div className="center mt" style={{ paddingBottom: 40 }}>
            <button className="btn ghost sm" onClick={() => nav('/stats')}>看我的详细统计 →</button>
          </div>
        </>
      )}

      {/* ══════════ 管理设置 ══════════ */}
      {tab === 'admin' && (
        <>
          {/* 家长解锁码：设码/改码在这张卡，其余设置在码后面 */}
          <div className="card pad">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🔐 家长解锁码</div>
            <div className="sub small" style={{ marginBottom: 10, lineHeight: 1.7 }}>
              「答案版」卷面、「纸质批改」页和下面的「管理设置」都要输这个码才能看，
              防止孩子自己偷看答案或改设置。
              {pinExists === false && ' 还没设置，建议现在设一个。'}
              {pinExists === true && ' 已设置。修改需先输旧码；连错 3 次锁 10 分钟。'}
            </div>
            {pinExists === true && (
              <input
                className="pinInput wide"
                placeholder="旧码（修改才需要）"
                value={oldPin}
                onChange={e => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" autoComplete="off"
                style={{ marginBottom: 8 }}
              />
            )}
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <input
                className="pinInput wide" style={{ flex: 1 }}
                placeholder="新码（4-6 位数字）"
                value={pin1}
                onChange={e => setPin1(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" autoComplete="off"
              />
              <input
                className="pinInput wide" style={{ flex: 1 }}
                placeholder="再输一遍确认"
                value={pin2}
                onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" autoComplete="off"
              />
            </div>
            <button className="btn sm" onClick={savePin} disabled={pin1.length < 4 || pin1 !== pin2}>保存解锁码</button>
            {pinMsg && <div className="sub small" style={{ marginTop: 8, color: 'var(--blue)', fontWeight: 600 }}>{pinMsg}</div>}
          </div>

          {pinExists === true && (
            <PinGate title="家长设置">
              {rulesMsg && (
                <div className="card pad" style={{ color: 'var(--blue)', fontWeight: 600, fontSize: 13 }}>
                  {rulesMsg}
                </div>
              )}

              {/* 预习环节档位 */}
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>📖 预习环节</div>
                <div className="sub small" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                  听写前先过一遍今天的词（卡片式、自动发音）。学不学、能不能跳过，由你定：
                </div>
                <div className="seg" style={{ marginBottom: 10 }}>
                  {(['recommended', 'force', 'off'] as const).map(m => (
                    <button key={m}
                      className={(rules.prepMode || 'recommended') === m ? 'on' : ''}
                      style={{ flex: 1 }}
                      onClick={() => saveRules({ prepMode: m })}>
                      {prepLabel[m]}
                    </button>
                  ))}
                </div>
                <div className="sub small" style={{ lineHeight: 1.7 }}>
                  {prepDesc[rules.prepMode || 'recommended']}
                </div>
              </div>

              {/* 出题顺序（从看板迁入） */}
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>🔀 出题顺序</div>
                <div className="seg" style={{ marginBottom: 10 }}>
                  {(['daily', 'weekly', 'manual'] as ShuffleModeUi[]).map(m => (
                    <button key={m} className={shuffleMode === m ? 'on' : ''} style={{ flex: 1 }}
                      onClick={() => switchMode(m)}>{modeLabel[m]}</button>
                  ))}
                </div>
                <div className="sub small" style={{ lineHeight: 1.7 }}>
                  {shuffleMode === 'daily' && '顺序每天自动换一次，孩子背不住昨天的词序。'}
                  {shuffleMode === 'weekly' && '一周内顺序固定方便对照，每周一自动全部重排。'}
                  {shuffleMode === 'manual' && '顺序长期不变，除非你点下面的「立即重排」。'}
                </div>
                <div className="row" style={{ gap: 10, marginTop: 10 }}>
                  <button className="btn ghost sm" onClick={rotate}>🎲 立即重排（全部天）</button>
                </div>
                <div className="sub small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                  「立即重排」在三种模式下都有效：点完当天线上卷和纸质卷就换新顺序。
                </div>
                {rotMsg && <div className="sub small" style={{ marginTop: 8, color: 'var(--blue)', fontWeight: 600 }}>{rotMsg}</div>}
              </div>

              {/* 输入规则（v2.8 从孩子端「设置」收归家长） */}
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>⌨️ 输入规则</div>
                <div className="field">
                  <div>
                    <div className="k">内置字母键盘</div>
                    <div className="d">只有 26 个字母，不弹输入法联想词（推荐开）</div>
                  </div>
                  <button
                    className={'switch' + (rules.kbBuiltIn !== false ? ' on' : '')}
                    onClick={() => saveRules({ kbBuiltIn: rules.kbBuiltIn === false })}
                    aria-label="内置键盘开关"
                  ><i /></button>
                </div>
                <div className="field">
                  <div>
                    <div className="k">纸质伴写</div>
                    <div className="d">听写时提示「写在听写本第 N 行」，完成后可拍照发给家长</div>
                  </div>
                  <button
                    className={'switch' + (rules.syncPaper !== false ? ' on' : '')}
                    onClick={() => saveRules({ syncPaper: rules.syncPaper === false })}
                    aria-label="纸质伴写开关"
                  ><i /></button>
                </div>
                <div className="sub small" style={{ lineHeight: 1.7 }}>
                  这两项原来在孩子的「设置」页，现在收归家长：孩子端只读显示，改不了。
                  保存后所有设备同步生效。
                </div>
              </div>

              {/* 家长寄语 */}
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>💌 家长寄语</div>
                <div className="sub small" style={{ marginBottom: 8, lineHeight: 1.7 }}>
                  写一句话，会显示在孩子的首页顶部。比如「先把昨天的错词订正了再玩」。
                  说具体的比「加油」管用。
                </div>
                <textarea
                  value={msgText}
                  onChange={e => setMsgText(e.target.value.slice(0, 100))}
                  rows={2}
                  placeholder="给孩子的一句话（最多 100 字）"
                  style={{
                    width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e4e8f0',
                    fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn sm" onClick={() => saveRules({ parentMessage: msgText.trim() })}>
                    保存寄语
                  </button>
                  {msgText && (
                    <button className="btn ghost sm" onClick={() => { setMsgText(''); saveRules({ parentMessage: '' }) }}>
                      清空
                    </button>
                  )}
                </div>
              </div>

              {/* 考试日期（v3.4 冲刺包） */}
              <div className="card pad">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>🎯 考试日期（考前冲刺）</div>
                <div className="sub small" style={{ marginBottom: 8, lineHeight: 1.7 }}>
                  设了日期，孩子首页就会从考前 14 天开始显示倒计时和每日冲刺建议，
                  并有「一键冲刺卷」（近两周错词）。考完把日期清掉即可。
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    type="date"
                    value={examDateText}
                    onChange={e => setExamDateText(e.target.value)}
                    style={{ flex: 1, padding: '9px 10px', borderRadius: 10, border: '1px solid #e4e8f0', fontSize: 14 }}
                  />
                  <button className="btn sm" disabled={!examDateText} onClick={() => saveRules({ examDate: examDateText })}>
                    保存
                  </button>
                  {examDateText && (
                    <button className="btn ghost sm" onClick={() => { setExamDateText(''); saveRules({ examDate: '' }) }}>
                      清除
                    </button>
                  )}
                </div>
              </div>

              {/* 每日计划与词库管理（v2.5，从看板迁入） */}
              <WordbookCard />
            </PinGate>
          )}

          {pinExists === false && (
            <div className="card pad sub small" style={{ lineHeight: 1.7 }}>
              先在上面设好解锁码，这一区才会打开——防止孩子自己进来改设置、看答案。
            </div>
          )}

          {pinExists === null && (
            <div className="card pad center sub">正在连接云端…（连不上就先看看「学习看板」）</div>
          )}
        </>
      )}
    </Shell>
  )
}

/**
 * 每日计划与词库管理：
 * - 每天几个新词（5/8/10/12/15），总天数自动 = 词库总量 ÷ 每日词量
 * - 册子切换：内置七上 / 家长粘贴创建的自定义册子（如六年级上）
 * - 粘贴格式：每行一个词，英文在前在后都认（apple 苹果 / 苹果 apple）
 */
function WordbookCard() {
  const [books, setBooks] = useState<BooksResp | null>(() => currentBooks())
  const [msg, setMsg] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  // 计划预览：第几天 / 总天数（跟 books 变化重算）
  const [plan, setPlan] = useState<{ day: number; total: number; bookName: string; count: number } | null>(null)

  const refresh = () => {
    void fetchWordbooks().then(b => setBooks(b))
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    let cancel = false
    void getPlanTrack().then(r => {
      if (!cancel) setPlan({ day: r.day, total: r.total, bookName: r.bookName, count: r.track.wordCount })
    })
    return () => { cancel = true }
  }, [books])

  const daily = books?.dailyWords ?? 10
  const active = books?.active || 'builtin7a'

  const setDaily = async (n: number) => {
    setMsg('保存中…')
    const okRes = await pushDailyWords(n)
    setMsg(okRes ? `已改为每天 ${n} 个新词，总天数自动重算` : '云端没连上，稍后再试')
    refresh()
  }

  const activate = async (id: string) => {
    setMsg('切换中…')
    const okRes = await pushActiveBook(id)
    setMsg(okRes ? '已切换册子，每日计划自动换成新词表' : '云端没连上，稍后再试')
    refresh()
  }

  const del = async (id: string, bname: string) => {
    if (!window.confirm(`确定删除「${bname}」？词单不可恢复。`)) return
    setMsg('删除中…')
    const okRes = await deleteWordbook(id)
    setMsg(okRes ? '已删除' : '删除失败：网络不通')
    refresh()
  }

  const create = async () => {
    if (!name.trim() || !text.trim()) { setMsg('先填册子名称，再把词单粘贴到下面的大框里'); return }
    setCreating(true)
    setMsg('创建中…')
    const r = await createWordbook(name.trim(), text)
    setCreating(false)
    if (r === null) { setMsg('创建失败：网络不通，稍后再试'); return }
    if ('error' in r) { setMsg(r.error); return }
    setMsg(`已创建「${name.trim()}」（${r.count} 词${r.skipped ? `，${r.skipped} 行没认出来跳过了` : ''}）。点列表里的「启用」才会用它出题。`)
    setName(''); setText('')
    refresh()
  }

  return (
    <div className="card pad">
      <div style={{ fontWeight: 800, marginBottom: 6 }}>📚 每日计划与词库</div>

      {/* 计划预览 */}
      {plan && (
        <div className="sub small" style={{ marginBottom: 10, lineHeight: 1.8 }}>
          当前：{plan.bookName} · 共 {plan.count} 词 · 每天 {daily} 个 → <b>{plan.total} 天听完</b>
          {plan.total > 0 && <> · 孩子学到第 {plan.day} 天</>}
        </div>
      )}

      {/* 每日新词数 */}
      <div className="sub small" style={{ marginBottom: 6 }}>每天听写几个新词：</div>
      <div className="seg" style={{ marginBottom: 12 }}>
        {[5, 8, 10, 12, 15].map(n => (
          <button key={n} className={daily === n ? 'on' : ''} style={{ flex: 1 }} onClick={() => setDaily(n)}>
            {n} 词
          </button>
        ))}
      </div>

      {/* 册子列表 */}
      <div className="sub small" style={{ marginBottom: 6 }}>用哪本词库出题：</div>
      {(books?.books || []).length === 0 && (
        <div className="sub small" style={{ marginBottom: 8 }}>
          云端还没连上或还没有自定义册子。内置《鲁教版七上》始终可用。
        </div>
      )}
      {(books?.books || []).map(b => (
        <div key={b.id} className="between" style={{
          padding: '8px 10px', marginBottom: 6, borderRadius: 10,
          border: '1px solid ' + (b.id === active ? 'var(--blue)' : '#e4e8f0'),
          background: b.id === active ? '#f3f7ff' : '#fff',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {b.id === active && <span style={{ color: 'var(--blue)', marginRight: 6 }}>✓</span>}
              {b.name}
            </div>
            <div className="sub small">{b.count} 词{b.id === 'builtin7a' ? ' · 内置' : ''}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {b.id !== active && (
              <button className="btn sm" style={{ fontSize: 12 }} onClick={() => activate(b.id)}>启用</button>
            )}
            {b.id !== 'builtin7a' && (
              <button className="btn ghost sm" style={{ fontSize: 12, color: 'var(--bad)' }} onClick={() => del(b.id, b.name)}>删</button>
            )}
          </div>
        </div>
      ))}

      {/* 粘贴创建 */}
      {!showCreate ? (
        <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setShowCreate(true)}>
          ＋ 粘贴词单建新册子（如：六年级上）
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <input
            className="pinInput wide"
            placeholder="册子名称，如：鲁教版六年级上"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 30))}
            style={{ marginBottom: 8, width: '100%' }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'每行一个词，英文在前在后都认：\nhold on 别挂断电话；等一等\n别挂断电话 hold on\napple 苹果'}
            rows={6}
            style={{
              width: '100%', padding: 10, borderRadius: 10, border: '1px solid #e4e8f0',
              fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div className="sub small" style={{ margin: '6px 0 8px', lineHeight: 1.7 }}>
            每行一个词，英文和中文用空格/逗号/Tab 分开都行。至少 5 个有效词。
            以后想要别的册子（六年级下、七年级下…），把整册词单粘进来就行。
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={create} disabled={creating}>
              {creating ? '创建中…' : '创建册子'}
            </button>
            <button className="btn ghost sm" onClick={() => { setShowCreate(false); setName(''); setText('') }}>收起</button>
          </div>
        </div>
      )}

      {msg && <div className="sub small" style={{ marginTop: 8, color: 'var(--blue)', fontWeight: 600, lineHeight: 1.7 }}>{msg}</div>}
    </div>
  )
}

/** 简易折线图（纯 SVG，无依赖） */
function TrendChart({ data }: { data: { day: string; acc: number; total: number }[] }) {
  const W = 620, H = 160, P = 28
  if (!data.length) return null
  const maxAcc = 100
  const stepX = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0
  const y = (v: number) => H - P - (v / maxAcc) * (H - P * 2)

  const pts = data.map((d, i) => [P + i * stepX, y(d.acc)] as const)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${P},${H - P} Z`

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 400, height: 160 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f5fd0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2f5fd0" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={P} y1={y(v)} x2={W - P} y2={y(v)} stroke="#e4e8f0" strokeWidth="1" />
            <text x={4} y={y(v) + 4} fontSize="10" fill="#8b93a3">{v}</text>
          </g>
        ))}
        <path d={area} fill="url(#g1)" />
        <path d={line} fill="none" stroke="#2f5fd0" strokeWidth="2.2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke="#2f5fd0" strokeWidth="1.8" />
        ))}
        {data.length <= 10 && data.map((d, i) => (
          <text key={d.day} x={P + i * stepX} y={H - 8} fontSize="9" fill="#8b93a3" textAnchor="middle">
            {d.day.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  )
}
