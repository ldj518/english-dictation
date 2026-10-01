import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import {
  fetchStats, checkBackend, fetchPinStatus, setParentPin, fetchPapers, paperFileUrl,
  createShare, rotateShuffleSalt, pushShuffleMode, currentShuffleMode, fetchShuffleSalt,
  fetchRecordings, recordFileUrl,
  fetchWordbooks, currentBooks, pushActiveBook, pushDailyWords, createWordbook, deleteWordbook,
  type StatsResp, type PhotoItem, type RecItem, type BooksResp,
} from '../lib/api'
import { getPlanTrack } from '../lib/data'
import { todayStr } from '../lib/storage'
import { sharePoster } from '../lib/poster'
import type { Progress } from '../types'

type Range = 'day' | 'week' | 'month'
type ShuffleModeUi = 'daily' | 'weekly' | 'manual'
const modeLabel: Record<ShuffleModeUi, string> = { daily: '每天换', weekly: '每周换', manual: '家长手动' }

/**
 * 家长看板：按 日 / 周 / 月 查看学习进度。
 * 数据来自 Cloudflare D1（后端），跨设备可见。
 * 后端不通时降级为本地数据 + 明确提示。
 */
export default function Parent() {
  const nav = useNavigate()
  const { profiles, profile, progress, switchProfile } = useStore()
  const [range, setRange] = useState<Range>('week')
  const [stats, setStats] = useState<StatsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState<boolean | null>(null)

  /* ── 家长解锁码 ── */
  const [pinExists, setPinExists] = useState<boolean | null>(null)
  const [oldPin, setOldPin] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinMsg, setPinMsg] = useState('')

  /* ── 纸质卷照片 ── */
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)

  /* ── 跟读录音 ── */
  const [recs, setRecs] = useState<RecItem[] | null>(null)
  const [openRecDay, setOpenRecDay] = useState<string | null>(null)

  /* ── 出题顺序 / 分享 ── */
  const [mode, setMode] = useState<ShuffleModeUi>(() => currentShuffleMode())
  const [rotMsg, setRotMsg] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareMsg, setShareMsg] = useState('')

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

  // 进页面时以云端为准刷新顺序模式（可能在别的设备上切过档）
  useEffect(() => {
    let cancel = false
    fetchShuffleSalt().finally(() => { if (!cancel) setMode(currentShuffleMode()) })
    return () => { cancel = true }
  }, [])

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
      setPinMsg('已保存。以后打开「答案版」和「纸质批改」都要输这个码')
    } else {
      setPinMsg(r.msg)
    }
  }

  /** 生成只读分享链接：对错统计 + 高频错词 + 最近的纸质卷照片 + 跟读录音 */
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
      photoKeys: (photos || []).slice(0, 6).map(p => p.key),
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
    <Shell title="家长看板" back sub={useLocal ? '本地数据' : '云端同步'}>
      {/* 后端状态提示 */}
      {useLocal && (
        <div className="card pad" style={{ background: 'var(--gold-soft)', borderColor: '#f0d69a' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>⚠️ 云端未连接，当前显示本机数据</div>
          <div className="sub small" style={{ marginTop: 4, lineHeight: 1.7 }}>
            本机数据只包含这台设备做过的练习。连上云端后，孩子在任意设备上的练习都会汇总到这里。
          </div>
        </div>
      )}

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

      {/* 切换孩子 */}
      {profiles.length > 1 && (
        <div className="profileBar">
          <div className="pList">
            {profiles.map(p => (
              <button key={p.id}
                className={'pChip' + (p.id === profile.id ? ' on' : '')}
                style={p.id === profile.id ? { borderColor: p.color, background: p.color + '14' } : {}}
                onClick={() => switchProfile(p.id)}>
                <span className="pe">{p.emoji}</span>
                <span className="pn">{p.name}</span>
              </button>
            ))}
          </div>
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

      {/* 最近记录 */}
      {!loading && !useLocal && stats && stats.recent.length > 0 && (
        <div className="card pad">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🕐 最近练习</div>
          <div className="reviewlist">
            {stats.recent.slice(0, 12).map(r => (
              <div key={r.id} className="rv">
                <span className="mk" style={{
                  color: r.score >= 90 ? 'var(--ok)' : r.score >= 60 ? 'var(--blue)' : 'var(--bad)',
                }}>{r.score}%</span>
                <span className="w" style={{ fontSize: 13 }}>{r.track_label}</span>
                <span className="sub small">
                  {r.right_count}/{r.total}
                  {r.mode === 'paper' && ' · 纸质'}
                  {r.mode === 'exam' && ' · 模考'}
                </span>
                <span className="sub small" style={{ marginLeft: 'auto' }}>{r.day_key.slice(5)}</span>
              </div>
            ))}
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

      {/* 家长解锁码 */}
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>🔐 家长解锁码</div>
        <div className="sub small" style={{ marginBottom: 10, lineHeight: 1.7 }}>
          「答案版」卷面和「纸质批改」页都要输这个码才能看，防止孩子自己偷看答案。
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

      {/* 出题顺序控制 */}
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

      {/* 每日计划与词库管理（v2.5） */}
      <WordbookCard />

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
                <div style={{ fontWeight: 700, fontSize: 14 }}>{day} <span className="sub small">· {list.length} 张</span></div>
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

      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost" onClick={() => location.reload()}>🔄 刷新数据</button>
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
