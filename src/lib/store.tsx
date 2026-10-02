import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import type { Progress, SessionResult, AnswerRecord, Track, Profile } from '../types'
import {
  load, save, defaultProgress, addWrong, advanceWrong, checkIn, judge, todayStr,
  loadProfiles, saveProfiles, activeProfileId, setActiveProfileId, reset as resetProgress,
} from './storage'
import { settle, addMinutes, type AwardCtx } from './gamify'
import { enqueueReview, advanceReview, resetReview, reopenReview } from './reviewQueue'
import { reportSession, syncStudent, checkBackend, fetchShuffleSalt, pushProgressSnapshot, fetchParentRules } from './api'
import type { ParentRules } from './api'
import { syncProfiles, pullAndMerge } from './sync'
import type { Badge } from '../types'

interface Ctx {
  progress: Progress
  /** 全部孩子身份 */
  profiles: Profile[]
  /** 当前活跃身份 */
  profile: Profile
  /** 切换身份（会重新加载该身份的进度） */
  switchProfile: (id: string) => void
  /** 修改身份信息（改名/换表情） */
  updateProfile: (id: string, patch: Partial<Profile>) => void
  /** 记录一道题（错词会自动入本） */
  recordAnswer: (word: string, cn: string, input: string, correct: boolean) => void
  /** 提交一次会话（mode 可指定上报形态：翻译关等，默认按任务类型推断；
   *  opts.skipBest：拼写类练习不占任务的「最好成绩」，避免污染听写分数显示） */
  submitSession: (track: Track, records: AnswerRecord[], seconds: number,
    mode?: 'online' | 'exam' | 'paper' | 'translate' | 'spell' | 'forms', opts?: { skipBest?: boolean }) => { newly: Badge[]; result: SessionResult }
  /** 复习模式：答对推进，答错重置 */
  recordReview: (word: string, cn: string, correct: boolean) => void
  updateSettings: (s: Partial<Progress['settings']>) => void
  clearWrong: () => void
  doReset: () => void
  /** 游戏奖励积分（连连看等纯游戏用；不进答题统计，不进错词本） */
  addPoints: (n: number) => void
  /** 每日计划完成到第几天（/d/plan 交卷后调） */
  markPlanDone: (day: number) => void
  /** 学习环节记账（v2.7）：记学习时间并计入当天分钟数 */
  markLearned: (taskId: string, seconds: number) => void
  /** 三格全齐奖励（v2.7）：预习+听写+照片当天同任务只加一次，加了返回 true */
  awardDailyBonus: (taskId: string) => boolean
}

const C = createContext<Ctx | null>(null)

/** 管控项：家长规则覆盖本地 settings（体验项如音量倍速不受影响）。
 *  导出给家长中心用：保存规则后同参数本机即时生效。 */
export function applyRules(s: ParentRules): Partial<Progress['settings']> {
  const out: Partial<Progress['settings']> = {}
  if (s.kbBuiltIn !== undefined) out.kbBuiltIn = s.kbBuiltIn
  if (s.shuffle !== undefined) out.shuffle = s.shuffle
  if (s.syncPaper !== undefined) out.syncPaper = s.syncPaper
  if (s.prepMode !== undefined) out.prepMode = s.prepMode
  return out
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles())
  const [activeId, setActiveId] = useState<string>(() => activeProfileId())
  const [progress, setProgress] = useState<Progress>(() => load(activeProfileId()))
  const [toast, setToast] = useState<Badge[]>([])

  // 活跃身份变化时重载进度
  useEffect(() => {
    setProgress(load(activeId))
  }, [activeId])

  // 启动时：探测后端 + 双向同步（身份档案 + 进度快照）+ 拉出题顺序盐
  // 规则应用与快照合并存在时序竞争：两边都可能 setProgress 覆盖对方，
  // 所以规则缓存进 ref，任何一侧完成后都补一次规则 patch
  const rulesRef = React.useRef<Partial<Progress['settings']>>({})
  const applyRulesPatch = React.useCallback(() => {
    if (!Object.keys(rulesRef.current).length) return
    setProgress(p => ({ ...p, settings: { ...p.settings, ...rulesRef.current } }))
  }, [])

  useEffect(() => {
    checkBackend().then(alive => {
      if (!alive) return
      // ① 身份档案：云端为准合并（改名后别的设备能看到；本地独有档案推上去）
      void syncProfiles(loadProfiles()).then(({ profiles: merged }) => {
        setProfiles(merged)
        for (const p of merged) syncStudent(p)
      })
      // ② 进度快照：逐个身份拉云端做无损合并（换设备不再失忆）
      for (const p of loadProfiles()) {
        void pullAndMerge(p.id).then(merged => {
          if (!merged) return
          if (p.id === activeProfileId()) {
            setProgress(merged)
            applyRulesPatch()
          }
        })
      }
      fetchShuffleSalt().catch(() => { /* 静默，保持本地缓存 */ })
      // ③ 家长管控规则：云端为准覆盖本地管控项（家长在自己手机上改，孩子设备生效）
      void fetchParentRules().then(rules => {
        rulesRef.current = applyRules(rules)
        applyRulesPatch()
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换身份：立即拉该孩子的云端快照合并（别的设备可能刚学完）
  useEffect(() => {
    checkBackend().then(alive => {
      if (!alive) return
      void pullAndMerge(activeId).then(merged => { if (merged) setProgress(merged) })
    })
  }, [activeId])

  // 每次进度变化按当前身份保存
  useEffect(() => { save(progress, activeId) }, [progress, activeId])

  // ── 进度快照推送：节流 15s，离开页面时立即冲刷 ──
  const pushTimer = React.useRef<number | null>(null)
  useEffect(() => {
    if (pushTimer.current) window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null
      void pushProgressSnapshot(activeId, progress)
    }, 15000)
    const flush = () => {
      if (!pushTimer.current) return
      window.clearTimeout(pushTimer.current)
      pushTimer.current = null
      void pushProgressSnapshot(activeId, progress)
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
      // 卸载（换身份/关页）也冲刷一次，避免丢最后 15 秒的进度
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current)
        pushTimer.current = null
        void pushProgressSnapshot(activeId, progress)
      }
    }
  }, [progress, activeId])

  const profile = useMemo(
    () => profiles.find(p => p.id === activeId) || profiles[0],
    [profiles, activeId]
  )

  const switchProfile = useCallback((id: string) => {
    setActiveProfileId(id)
    setActiveId(id)
  }, [])

  const updateProfile = useCallback((id: string, patch: Partial<Profile>) => {
    setProfiles(prev => {
      const next = prev.map(p => (p.id === id ? { ...p, ...patch } : p))
      saveProfiles(next)
      // 改名/换头像立即推云端——别的设备下次打开就能看到（v2.6 修复的名字不同步）
      const p = next.find(x => x.id === id)
      if (p) void syncStudent(p)
      return next
    })
  }, [])

  // 会话内累计（答题过程中不断累积，提交时结算）
  const buffer = React.useRef<{
    total: number; right: number; streak: number; maxStreak: number
    records: AnswerRecord[]
  }>({ total: 0, right: 0, streak: 0, maxStreak: 0, records: [] })

  const recordAnswer = useCallback((word: string, cn: string, input: string, correct: boolean) => {
    const b = buffer.current
    b.total += 1
    b.records.push({ no: b.total, word, cn, input, correct })
    if (correct) {
      b.right += 1
      b.streak += 1
      b.maxStreak = Math.max(b.maxStreak, b.streak)
      setProgress(p => {
        const np = { ...p }
        np.totalAnswers += 1
        np.totalRight += 1
        // 答对：如果在错词本里，且不是复习模式，暂不推进，由复习模式负责
        return np
      })
    } else {
      b.streak = 0
      setProgress(p => {
        const np = { ...p }
        np.totalAnswers += 1
        addWrong(np, word, cn)
        return np
      })
    }
  }, [])

  const submitSession = useCallback((track: Track, records: AnswerRecord[], seconds: number,
    mode?: 'online' | 'exam' | 'paper' | 'translate' | 'spell' | 'forms', opts?: { skipBest?: boolean }) => {
    const total = records.length
    const right = records.filter(r => r.correct).length
    const score = total ? Math.round((right / total) * 100) : 0
    const result: SessionResult = {
      trackId: track.id, trackLabel: track.label || track.id,
      total, right, score, at: Date.now(), records,
    }
    let newly: Badge[] = []
    setProgress(p => {
      const np = JSON.parse(JSON.stringify(p)) as Progress
      const b = buffer.current
      // 打卡
      checkIn(np)
      // 最好成绩（拼写类练习跳过：不占任务卡上显示的听写分数）
      if (!opts?.skipBest) {
        const prevBest = np.best[track.id]
        if (!prevBest || score > prevBest.score) {
          np.best[track.id] = { score, at: Date.now(), right, total }
        }
      }
      np.attempts[track.id] = (np.attempts[track.id] || 0) + 1
      np.history = [result, ...np.history].slice(0, 200)
      addMinutes(np, Math.max(1, Math.round(seconds / 60)))
      // 全词复习队列（v3.1）：答对入队/推进，答错退档；毕业 +10 分
      // v3.2 修复：毕业词记入 reviewDone，日常听写答对不再重新入队（队列永不收敛的 bug）；
      // 毕业词答错 → reopenReview 重新走曲线
      if (mode !== 'paper') {
        for (const r of records) {
          if (r.correct) {
            if (np.review[r.word]) {
              const grad = advanceReview(np, r.word)
              if (grad) np.points += 10
            } else {
              enqueueReview(np, r.word)
            }
          } else if (np.reviewDone?.[r.word]) {
            reopenReview(np, r.word)
          } else {
            resetReview(np, r.word)
          }
        }
      }
      const ctx: AwardCtx = {
        perfect: score === 100 && total > 0,
        maxStreak: b.maxStreak,
        right, kind: track.kind, trackId: track.id, score,
      }
      newly = settle(np, ctx)
      return np
    })
    // 重置缓冲
    buffer.current = { total: 0, right: 0, streak: 0, maxStreak: 0, records: [] }
    if (newly.length) setToast(newly)

    // 上报后端（fire-and-forget，失败不影响本地）
    reportSession({
      studentId: activeId,
      trackId: track.id,
      trackLabel: result.trackLabel,
      kind: track.kind,
      mode: mode || (track.kind === 'daily' ? 'online' : 'exam'),
      seconds,
      records,
    }).catch(() => { /* 静默 */ })

    return { newly, result }
  }, [activeId])

  const recordReview = useCallback((word: string, cn: string, correct: boolean) => {
    setProgress(p => {
      const np = JSON.parse(JSON.stringify(p)) as Progress
      if (correct) {
        np.totalAnswers += 1
        np.totalRight += 1
        const { graduated } = advanceWrong(np, word)
        np.points += graduated ? 20 : 8
      } else {
        np.totalAnswers += 1
        addWrong(np, word, cn)
      }
      return np
    })
  }, [])

  const updateSettings = useCallback((s: Partial<Progress['settings']>) => {
    setProgress(p => ({ ...p, settings: { ...p.settings, ...s } }))
  }, [])

  const clearWrong = useCallback(() => {
    setProgress(p => ({ ...p, wrong: {} }))
  }, [])

  const addPoints = useCallback((n: number) => {
    setProgress(p => ({ ...p, points: Math.max(0, p.points + n) }))
  }, [])

  /** 每日计划完成记账：planDone 只进不退（重做旧的一遍不回退天数） */
  const markPlanDone = useCallback((day: number) => {
    setProgress(p => ({ ...p, planDone: Math.max(p.planDone || 0, day) }))
  }, [])

  /** 学习环节记账（v2.7）：时间戳 + 次数，时长折算进当天学习分钟数 */
  const markLearned = useCallback((taskId: string, seconds: number) => {
    setProgress(p => {
      const np = JSON.parse(JSON.stringify(p)) as Progress
      const cur = np.learned[taskId] || { at: 0, count: 0 }
      np.learned[taskId] = { at: Date.now(), count: cur.count + 1, bonusDay: cur.bonusDay }
      addMinutes(np, Math.max(1, Math.round(seconds / 60)))
      return np
    })
  }, [])

  /** 三格奖励：当天（同任务）预习过才发，一次 10 分 */
  const awardDailyBonus = useCallback((taskId: string) => {
    const today = todayStr()
    let awarded = false
    setProgress(p => {
      const cur = p.learned[taskId]
      if (!cur || cur.bonusDay === today) return p
      awarded = true
      return {
        ...p,
        points: p.points + 10,
        learned: { ...p.learned, [taskId]: { ...cur, bonusDay: today } },
      }
    })
    return awarded
  }, [])

  const doReset = useCallback(() => {
    const np = defaultProgress()
    resetProgress(activeId)
    setProgress(np)
  }, [activeId])

  const value = useMemo(() => ({
    progress, profiles, profile, switchProfile, updateProfile,
    recordAnswer, submitSession, recordReview, updateSettings, clearWrong, doReset, addPoints, markPlanDone,
    markLearned, awardDailyBonus,
  }), [progress, profiles, profile, switchProfile, updateProfile,
       recordAnswer, submitSession, recordReview, updateSettings, clearWrong, doReset, addPoints, markPlanDone,
       markLearned, awardDailyBonus])

  return (
    <C.Provider value={value}>
      {children}
      {toast.length > 0 && (
        <div className="badgeToast" onClick={() => setToast([])}>
          {toast.map(b => (
            <div key={b.id} className="badgePop">
              <span className="bi">{b.icon}</span>
              <div>
                <div className="bt">解锁成就 · {b.name}</div>
                <div className="bd">{b.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </C.Provider>
  )
}

export function useStore() {
  const c = useContext(C)
  if (!c) throw new Error('useStore must be inside StoreProvider')
  return c
}

export { judge, todayStr }
