import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import type { Progress, SessionResult, AnswerRecord, Track, Profile } from '../types'
import {
  load, save, defaultProgress, addWrong, advanceWrong, checkIn, judge, todayStr,
  loadProfiles, saveProfiles, activeProfileId, setActiveProfileId, reset as resetProgress,
} from './storage'
import { settle, addMinutes, type AwardCtx } from './gamify'
import { reportSession, syncStudent, checkBackend, fetchShuffleSalt } from './api'
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
  /** 提交一次会话（mode 可指定上报形态：翻译关等，默认按任务类型推断） */
  submitSession: (track: Track, records: AnswerRecord[], seconds: number, mode?: 'online' | 'exam' | 'paper' | 'translate') => { newly: Badge[]; result: SessionResult }
  /** 复习模式：答对推进，答错重置 */
  recordReview: (word: string, cn: string, correct: boolean) => void
  updateSettings: (s: Partial<Progress['settings']>) => void
  clearWrong: () => void
  doReset: () => void
  /** 每日计划完成到第几天（/d/plan 交卷后调） */
  markPlanDone: (day: number) => void
}

const C = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles())
  const [activeId, setActiveId] = useState<string>(() => activeProfileId())
  const [progress, setProgress] = useState<Progress>(() => load(activeProfileId()))
  const [toast, setToast] = useState<Badge[]>([])

  // 活跃身份变化时重载进度
  useEffect(() => {
    setProgress(load(activeId))
  }, [activeId])

  // 启动时：探测后端 + 把身份同步上去（供家长看板识别）+ 拉出题顺序盐
  useEffect(() => {
    checkBackend().then(alive => {
      if (!alive) return
      for (const p of profiles) {
        syncStudent({ id: p.id, name: p.name, emoji: p.emoji, color: p.color })
      }
      fetchShuffleSalt().catch(() => { /* 静默，保持本地缓存 */ })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 每次进度变化按当前身份保存
  useEffect(() => { save(progress, activeId) }, [progress, activeId])

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

  const submitSession = useCallback((track: Track, records: AnswerRecord[], seconds: number, mode?: 'online' | 'exam' | 'paper' | 'translate') => {
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
      // 最好成绩
      const prevBest = np.best[track.id]
      if (!prevBest || score > prevBest.score) {
        np.best[track.id] = { score, at: Date.now(), right, total }
      }
      np.attempts[track.id] = (np.attempts[track.id] || 0) + 1
      np.history = [result, ...np.history].slice(0, 200)
      addMinutes(np, Math.max(1, Math.round(seconds / 60)))
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

  /** 每日计划完成记账：planDone 只进不退（重做旧的一遍不回退天数） */
  const markPlanDone = useCallback((day: number) => {
    setProgress(p => ({ ...p, planDone: Math.max(p.planDone || 0, day) }))
  }, [])

  const doReset = useCallback(() => {
    const np = defaultProgress()
    resetProgress(activeId)
    setProgress(np)
  }, [activeId])

  const value = useMemo(() => ({
    progress, profiles, profile, switchProfile, updateProfile,
    recordAnswer, submitSession, recordReview, updateSettings, clearWrong, doReset, markPlanDone,
  }), [progress, profiles, profile, switchProfile, updateProfile,
       recordAnswer, submitSession, recordReview, updateSettings, clearWrong, doReset, markPlanDone])

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
