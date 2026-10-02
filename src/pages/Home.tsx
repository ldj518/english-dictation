import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import ProfileSwitcher from '../components/ProfileSwitcher'
import { useStore } from '../lib/store'
import { levelOf, BADGES } from '../lib/gamify'
import { DAILY, UNITS, FINALS, getPlanTrack, WORDS } from '../lib/data'
import { fetchWordbooks, fetchParentRules } from '../lib/api'
import { dueWrongWords, todayStr } from '../lib/storage'
import { seededShuffle, makeSeed } from '../lib/shuffle'
import { dueReviews } from '../lib/reviewQueue'
import type { Track } from '../types'

type Tab = 'daily' | 'unit' | 'final'

export default function Home() {
  const nav = useNavigate()
  const { progress, profile } = useStore()
  const [tab, setTab] = useState<Tab>('daily')

  const lv = levelOf(progress.points)
  const pct = Math.min(100, Math.round(((progress.points - lv.cur) / Math.max(1, lv.next - lv.cur)) * 100))
  const due = dueWrongWords(progress)
  const rvDue = dueReviews(progress).length

  // 下一个该做的
  const nextTask = useMemo(() => {
    const un = DAILY.find(d => !progress.best[d.id])
    return un || DAILY[0]
  }, [progress.best])

  const todayMin = progress.minutes[todayStr()] || 0
  const doneCount = Object.keys(progress.best).length
  const wrongCount = Object.keys(progress.wrong).length
  const acc = progress.totalAnswers ? Math.round((progress.totalRight / progress.totalAnswers) * 100) : 0

  // 断档天数（v3.3）：lastDay 距今天几天。0=今天学过 1=昨天学的 2+=断档
  const gapDays = useMemo(() => {
    if (!progress.lastDay) return 0
    const [y1, m1, d1] = progress.lastDay.split('-').map(Number)
    const [y2, m2, d2] = todayStr().split('-').map(Number)
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
  }, [progress.lastDay])

  // 今日三件事（v3.3）：听写练习 / 到期复习清零 / 翻译关，从记录现算不新增存储
  const trio = useMemo(() => {
    const t = todayStr()
    const th = progress.history.filter(h => todayStr(new Date(h.at)) === t)
    const didDict = th.some(h => !h.trackId.endsWith('-t'))
    const didTrans = th.some(h => h.trackId.endsWith('-t'))
    const reviewClear = dueReviews(progress).length === 0
    return { didDict, reviewClear, didTrans, got: !!progress.trioDone?.[t], n: [didDict, reviewClear, didTrans].filter(Boolean).length }
  }, [progress])

  // 每日计划（家长自定义：每天 N 个新词，总天数自动算）
  const [plan, setPlan] = useState<{ day: number; total: number; bookName: string; count: number } | null>(null)
  useEffect(() => {
    let cancel = false
    // 先刷一次册子配置（激活册子/每日词量，云端为准），再合成今日计划
    fetchWordbooks().catch(() => null).finally(() => {
      void getPlanTrack().then(r => {
        if (!cancel) setPlan({ day: r.day, total: r.total, bookName: r.bookName, count: r.track.wordCount })
      })
    })
    return () => { cancel = true }
  }, [profile.id, progress.planDone])

  const list = tab === 'daily' ? DAILY : tab === 'unit' ? UNITS : FINALS

  // 家长寄语（v2.8）：家长在家长中心写的，云端存储，非空才显示
  const [pmsg, setPmsg] = useState('')
  useEffect(() => {
    let cancel = false
    fetchParentRules().then(r => { if (!cancel) setPmsg((r.parentMessage || '').trim()) }).catch(() => { /* 静默 */ })
    return () => { cancel = true }
  }, [])

  return (
    <Shell title="英语听写" right={
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="设置">⚙️</button>
    }>
      {/* 身份：只显示当前孩子；切人走弹层（有意操作，防误触记错人） */}
      <div className="profileBar">
        <ProfileSwitcher />
      </div>

      {/* 家长寄语（家长中心设置，云端同步） */}
      {pmsg && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>💌</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>{pmsg}</div>
              <div className="sub small" style={{ marginTop: 2 }}>—— 家长的话</div>
            </div>
          </div>
        </div>
      )}

      {/* 等级总览（带当前身份：孩子随时能确认「现在是我」） */}
      <div className="hero">
        <div className="who">{profile.emoji} {profile.name}的学习基地</div>
        <div className="lv">LEVEL {lv.lv}</div>
        <div className="nm">{lv.name}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
        <div className="meta">
          <div><b>{progress.points}</b>积分</div>
          <div><b>{progress.streakDays}</b>连续天数</div>
          <div><b>{todayMin}</b>今日分钟</div>
        </div>
      </div>

      {/* 今日三件事（v3.3）：集齐 = 完美一天 +30 分（submitSession 自动发） */}
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>✅ 今日三件事</div>
            <div className="sub small" style={{ marginTop: 3 }}>
              {trio.n === 3 ? (trio.got ? '完美一天！+30 分已到账' : '完美一天！+30 分马上到账') : `集齐三件 = 完美一天 +30 分（已齐 ${trio.n}/3）`}
            </div>
          </div>
          <TrioRing n={trio.n} />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className={'btn sm' + (trio.didDict ? ' ok-dim' : '')} style={{ flex: '1 1 30%', background: trio.didDict ? 'var(--ok-soft)' : undefined }}
            onClick={() => nav('/d/plan')}>
            {trio.didDict ? '✓' : '①'} 听写练习
          </button>
          <button className={'btn sm' + (trio.reviewClear ? ' ok-dim' : '')} style={{ flex: '1 1 30%', background: trio.reviewClear ? 'var(--ok-soft)' : undefined }}
            onClick={() => nav('/d/review')}>
            {trio.reviewClear ? '✓' : '②'} 到期复习
          </button>
          <button className={'btn sm' + (trio.didTrans ? ' ok-dim' : '')} style={{ flex: '1 1 30%', background: trio.didTrans ? 'var(--ok-soft)' : undefined }}
            onClick={() => nav('/translate/plan')}>
            {trio.didTrans ? '✓' : '③'} 翻译关
          </button>
        </div>
      </div>

      {/* 考前冲刺（v3.4）：家长设了考试日期，考前 14 天开始显示 */}
      {(() => {
        const examDate = progress.settings.examDate
        if (!examDate) return null
        const exam = new Date(examDate + 'T00:00:00').getTime()
        const today0 = new Date(todayStr() + 'T00:00:00').getTime()
        const daysLeft = Math.round((exam - today0) / 86400000)
        if (daysLeft < 0 || daysLeft > 14) return null // 考完/冲刺期外不打扰
        const urgent = daysLeft <= 3
        return (
          <div className="card pad" style={{ marginBottom: 14, borderColor: urgent ? '#f1b3b3' : '#f0d69a', background: urgent ? 'linear-gradient(180deg,#fff5f5,#fff)' : 'linear-gradient(180deg,#fffdf5,#fff)' }}>
            <div className="between">
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  🎯 距考试还有 {daysLeft === 0 ? '不到 1' : daysLeft} 天
                </div>
                <div className="sub small" style={{ marginTop: 3, lineHeight: 1.7 }}>
                  {daysLeft === 0
                    ? '今天就是考试日。放轻松，正常发挥就好。'
                    : urgent
                      ? '最后几天：把错词本清干净，错词卷多过一遍，别碰太新的题。'
                      : '每天两件事：① 清掉当天到期的错词 ② 做一张薄弱单元的过关测试。'}
                </div>
              </div>
              {daysLeft > 0 && (
                <button className="btn sm" style={{ background: '#a32d2d' }} onClick={() => {
                  // 冲刺卷：近 14 天碰过的错词优先，按累计错误次数排
                  const since = Date.now() - 14 * 86400000
                  const pool = Object.values(progress.wrong).filter(w => w.lastAt >= since)
                  const list = (pool.length ? pool : Object.values(progress.wrong))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 20)
                    .map(w => ({ word: w.word, cn: w.cn }))
                  if (!list.length) { alert('错词本是空的，直接做今天的每日计划卷就行'); return }
                  sessionStorage.setItem('custom-words', JSON.stringify(list))
                  sessionStorage.setItem('custom-label', '考前冲刺卷')
                  nav('/d/custom')
                }}>⚡ 一键冲刺卷</button>
              )}
            </div>
          </div>
        )
      })()}

      {/* 每日计划：三态引导（v3.3）——正常 / 断 1 天橙 / 断 2 天+ 红 */}
      {plan && (() => {
        const miss = gapDays - 1
        const missed = miss >= 1 && progress.lastDay !== undefined && progress.lastDay !== ''
        const serious = miss >= 2
        const borderColor = serious ? '#f09595' : missed ? '#fac775' : '#b2c7f5'
        const bg = serious ? 'linear-gradient(180deg,#fdf3f2,#fff)' : missed ? 'linear-gradient(180deg,#fffaf0,#fff)' : 'linear-gradient(180deg,#f3f7ff,#fff)'
        return (
          <div className="card pad" style={{ marginBottom: 14, borderColor, background: bg }}>
            <div className="between" style={{ marginBottom: 12 }}>
              <div>
                <div className="sub">每日计划 · {plan.bookName}</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                  {serious
                    ? <>停了 {miss} 天，词汇在往回漏</>
                    : missed
                      ? <>昨天没练，计划还在等你</>
                      : <>第 {plan.day} / {plan.total} 天</>}
                  <span className="sub" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                    {missed ? `从第 ${plan.day} 天继续` : `每天 ${plan.count} 个新词`}
                  </span>
                </div>
                {serious && (
                  <div className="sub small" style={{ marginTop: 3, lineHeight: 1.6 }}>
                    漏掉的词复习队列会自动安排回炉。不用内疚，今天从第 {plan.day} 天接着走就行。
                  </div>
                )}
              </div>
              <div style={{ fontSize: 30 }}>{serious ? '📢' : missed ? '⏰' : '📅'}</div>
            </div>
            <button className="btn" style={{ background: serious ? '#a32d2d' : 'var(--blue)' }} onClick={() => nav('/d/plan')}>
              {serious ? '⚡ 补上 · 第' : missed ? '▶ 继续 · 第' : '▶ 今日听写 · 第'} {plan.day} 天
            </button>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Link className="btn ghost sm" to="/print/plan" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                🖨️ 打今日卷
              </Link>
              <Link className="btn ghost sm" to="/translate/plan" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                🔤 翻译巩固
              </Link>
              <Link className="btn ghost sm" to="/spell/plan" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                ✏️ 首字母填空
              </Link>
              <Link className="btn ghost sm" to="/forms/all" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                📝 词形变换
              </Link>
              <Link className="btn ghost sm" to="/listen/plan" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                📄 纸听一遍
              </Link>
              <Link className="btn ghost sm" to="/days" style={{ flex: '1 1 30%', textAlign: 'center' }}>
                🗓️ 选日子
              </Link>
            </div>
          </div>
        )
      })()}

      {/* 智能混合卷：只抽学过/错过的词，没学过的绝不出现 */}
      <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>🎲 智能混合卷</div>
            <div className="sub small" style={{ marginTop: 3 }}>
              从学过的词和错词本里随机抽一组混着练，检验记得牢不牢
            </div>
          </div>
          <button className="btn gold sm" onClick={() => nav('/d/mix')}>开始</button>
        </div>
      </div>

      {/* 短语专项（v3.4）：87 条固定搭配每日一组，对标考试「短语/介词搭配」失分点 */}
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>🔗 短语专项 · 每日 12 条</div>
            <div className="sub small" style={{ marginTop: 3 }}>
              hold on、take a message 这类固定搭配，考试最爱考。每天专攻一组
            </div>
          </div>
          <button className="btn sm" onClick={() => {
            // 词源=词库里含空格的短语条目（87 条）；同一天同一人固定同一组
            const pool = WORDS.filter(w => w.word.includes(' '))
            const list = seededShuffle(pool, makeSeed(todayStr(), profile.id, 'phrases'))
              .slice(0, 12)
              .map(w => ({ word: w.word, cn: w.cn }))
            sessionStorage.setItem('custom-words', JSON.stringify(list))
            sessionStorage.setItem('custom-label', '短语专项')
            nav('/d/custom')
          }}>开始</button>
        </div>
      </div>

      {/* 今日任务：自动推进到第一个没完成的 */}
      {nextTask && (
        <div className="card pad" style={{ marginBottom: 14 }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div>
              <div className="sub">今日任务 · 第 {nextTask.order} / {DAILY.length} 天</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                {nextTask.label || `第 ${nextTask.order} 天`}
                <span className="sub" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                  {nextTask.wordCount} 词
                </span>
              </div>
            </div>
            <div style={{ fontSize: 30 }}>🎧</div>
          </div>
          <button className="btn" onClick={() => nav(`/d/${nextTask.id}`)}>
            ▶ 开始听写
          </button>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {/* 注意：必须用 <Link> 而不是 href="#/..."。
                应用是 BrowserRouter（History 模式），hash 链接不会触发路由导航，
                点击只会往地址栏加个 #，页面纹丝不动（用户报的「点了没反应」就是这个） */}
            <Link className="btn ghost sm" to={`/translate/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🔤 翻译关
            </Link>
            <Link className="btn ghost sm" to={`/spell/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              ✏️ 首字母填空
            </Link>
            <Link className="btn ghost sm" to={`/read/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🎙️ 跟读录音
            </Link>
            <Link className="btn ghost sm" to={`/print/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              🖨️ 打纸质卷
            </Link>
            <Link className="btn ghost sm" to={`/paper/${nextTask.id}`} style={{ flex: '1 1 40%', textAlign: 'center' }}>
              📷 纸质批改
            </Link>
          </div>
        </div>
      )}

      {/* 快捷入口：训练场 + 游戏中心 + 掌握地图 + 家长看板 */}
      <div className="quickRow">
        <button className="quick" onClick={() => nav('/train')}>
          <span className="qi">🎯</span>
          <span className="qt">训练场</span>
          <span className="qd">闪卡·限时·拼写</span>
        </button>
        <button className="quick" onClick={() => nav('/games')}>
          <span className="qi">🎮</span>
          <span className="qt">游戏中心</span>
          <span className="qd">连连看·打怪兽</span>
        </button>
        <button className="quick" onClick={() => nav('/map')}>
          <span className="qi">🗺️</span>
          <span className="qt">掌握地图</span>
          <span className="qd">每个词的真实状态</span>
        </button>
        <button className="quick" onClick={() => nav('/parent')}>
          <span className="qi">📊</span>
          <span className="qt">家长中心</span>
          <span className="qd">进度·设置管理</span>
        </button>
      </div>

      {/* 今日复习（v3.1 全词复习队列：以前学对的词按遗忘曲线回炉） */}
      {rvDue > 0 && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#c9dbf5', background: 'linear-gradient(180deg,#f4f8ff,#fff)' }}>
          <div className="between">
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                📋 今日到期复习 {rvDue} 词
              </div>
              <div className="sub small" style={{ marginTop: 3, lineHeight: 1.7 }}>
                以前学对的词今天该回炉了，趁还记得多，复习最快
              </div>
            </div>
            <button className="btn sm" onClick={() => nav('/d/review')}>开始复习</button>
          </div>
        </div>
      )}

      {/* 待复习提示 */}
      {due.length > 0 && (
        <div className="card pad" style={{ marginBottom: 14, borderColor: '#f0d69a', background: 'linear-gradient(180deg,#fffdf5,#fff)' }}>
          <div className="between">
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                🔔 今天该复习 {due.length} 个错词
              </div>
              <div className="sub small" style={{ marginTop: 3 }}>
                按遗忘曲线排的，现在复习效果最好
              </div>
            </div>
            <button className="btn gold sm" onClick={() => nav('/review')}>去复习</button>
          </div>
        </div>
      )}

      {/* 统计格 */}
      <div className="stats">
        <div className="stat"><b>{doneCount}</b><span>完成任务</span></div>
        <div className="stat"><b>{acc}%</b><span>总正确率</span></div>
        <div className="stat"><b>{wrongCount}</b><span>待巩固</span></div>
        <div className="stat"><b>{Object.keys(progress.badges).length}</b><span>成就</span></div>
      </div>

      {/* 任务列表 */}
      <div className="tabs">
        {([['daily', '每日课程'], ['unit', '单元测试'], ['final', '期末模考']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      <div className="grid">
        {list.map(t => <Cell key={t.id} t={t} />)}
      </div>

      {/* 成就墙 */}
      <div className="card pad" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>
          🏅 成就墙
          <span className="sub small" style={{ fontWeight: 400, marginLeft: 8 }}>
            {Object.keys(progress.badges).length} / {BADGES.length}
          </span>
        </div>
        <div className="badges">
          {BADGES.map(b => (
            <div key={b.id} className={'bg' + (progress.badges[b.id] ? ' got' : '')} title={b.desc}>
              <div className="i">{b.icon}</div>
              <div className="n">{b.name}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

/** 三段进度环：n = 已完成件数（0-3） */
function TrioRing({ n }: { n: number }) {
  const R = 26
  const C = 2 * Math.PI * R
  const seg = C / 3
  return (
    <svg width="66" height="66" viewBox="0 0 70 70" role="img" aria-label={`三件事完成 ${n} / 3`}>
      <circle cx="35" cy="35" r={R} fill="none" stroke="#e8e6df" strokeWidth="7" />
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx="35" cy="35" r={R} fill="none" stroke="#3b6d11" strokeWidth="7"
          strokeDasharray={`${seg - 5} ${C - seg + 5}`} strokeDashoffset={-i * seg}
          transform="rotate(-90 35 35)" strokeLinecap="round" />
      ))}
      <text x="35" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill="#27500a">{n}/3</text>
    </svg>
  )
}

function Cell({ t }: { t: Track }) {
  const nav = useNavigate()
  const { progress } = useStore()
  const best = progress.best[t.id]
  // 单元过关章（v3.4）：≥85 分过关后单元卡常亮
  const passed = t.kind === 'unit' ? progress.passed?.[t.id] : undefined

  const cls = !best ? '' : best.score >= 90 ? 's100' : best.score >= 60 ? 's60' : 's0'
  const title = t.kind === 'daily' ? `第 ${t.order} 天`
    : t.kind === 'unit' ? `Unit ${String(t.order).padStart(2, '0')}`
      : `期末 ${String(t.order).padStart(2, '0')}`

  // 每日听写 → 逐题反馈模式；单元/期末 → 整卷模考模式
  const go = () => t.kind === 'daily' ? nav(`/d/${t.id}`) : nav(`/exam/${t.id}`)

  return (
    <div className={'cellWrap'}>
      <button className={'cell' + (best ? ' done' : '')} onClick={go}>
        <div className="n">{title}{passed ? ' 🏅' : ''}</div>
        <div className="t">{t.wordCount} 词{passed ? ` · 过关 ${passed.score} 分` : ''}</div>
        {best ? <div className={'s ' + cls}>{best.score}%</div> : <div className="t">未做</div>}
      </button>
      {t.kind === 'unit' && (
        <Link className="cellPrint cellTest" to={`/test/${t.id}`} title="过关测试（20 题，85 分过关）">🎯</Link>
      )}
      <Link className="cellPrint" to={`/print/${t.id}`} title="打印纸质卷">🖨️</Link>
    </div>
  )
}
