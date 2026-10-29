/**
 * 首页主卡（v4）——「今天这一场」的唯一入口。
 *
 * 只在首页显示状态摘要，真正的会话在 /today。
 * 这里的所有数字都来自 buildPlan / queueHealth，和 /today 里那一场是同一个口径
 * ——首页说「约 8 段 28 分钟」，进去就必须是 8 段，不能两边各算一套。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { WORDS } from '../lib/data'
import { todayStr } from '../lib/storage'
import { bjDiffDays, bjDow } from '../lib/bj'
import { buildPlan, mustTotalOf, mergeCfg, perItemSecOf, rampWeekOf, gapDaysOf } from '../lib/plan'
import { queueHealth } from '../lib/memory'
import { schoolUnitOf } from '../lib/school'

export default function TodayCard() {
  const nav = useNavigate()
  const { progress } = useStore()
  const day = todayStr()

  const info = useMemo(() => {
    const h = queueHealth(progress, day)
    const gap = gapDaysOf(progress, day)
    const hasNew = WORDS.some(w => !progress.wordState?.[w.word])
    const cfg = mergeCfg(progress.studyCfg)
    const week = rampWeekOf(progress.rampFrom || day, day)
    // 学校单元必须和 /today 用同一个来源，否则首页说 6 段、进去是 8 段
    const sch = schoolUnitOf(progress)
    const plan = buildPlan({
      dayKey: day, gapDays: gap, dueN: h.due, weakN: h.weak, nailN: h.nails,
      // 手速取近 7 天实测：以前写死 20 秒，题量对快手慢手一个样
      forgetRate: h.forgetRate, perItemSec: perItemSecOf(progress, day), hasNew,
      schoolLeft: sch.left,
      rampWeek: week, cfg: progress.studyCfg,
    })
    const log = progress.dayLog?.[day]
    return { h, gap, plan, cfg, log, mustAll: mustTotalOf(plan), week, sch }
  }, [progress, day])

  const { h, gap, plan, cfg, log, mustAll, week } = info
  const done = !!log?.done
  const started = !!log && (log.effSec > 0 || log.mustDone > 0)
  const usedMin = Math.round((log?.effSec || 0) / 60)
  const dow = bjDow(day)
  const wd = ['日', '一', '二', '三', '四', '五', '六'][dow]

  return (
    <div className={'card pad v4home' + (done ? ' ok' : '')}>
      <div className="between" style={{ marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {done ? '✓ 今天已完成' : started ? '继续今天这一场' : '今天这一场'}
          </div>
          <div className="sub small" style={{ marginTop: 2 }}>
            周{wd} · {plan.tierNote}
          </div>
        </div>
        <div className="v4homeTag">{plan.weekend ? '周末' : '工作日'} · 约 {plan.estMin}′</div>
      </div>

      {/* 只留一条进度：必做。时间那条**故意删掉**——
          它的存在会让孩子以为「没坐满就是没做完」，正是之前死锁的观感来源。 */}
      <div className="v4homeBars">
        <div>
          <div className="v4hbTop">
            <span>必做</span>
            <b>{log?.mustDone || 0}<i>/{mustAll}</i></b>
            <em>（今天用了 {usedMin} 分钟）</em>
          </div>
          <div className="v4bar">
            <i style={{ width: Math.min(100, Math.round(((log?.mustDone || 0) / Math.max(1, mustAll)) * 100)) + '%', background: (log?.mustDone || 0) >= mustAll ? 'var(--ok)' : 'var(--gold)' }} />
          </div>
        </div>
      </div>

      {/* 队列一句话：到期多少、还剩多少没掌握、钉子词多少 */}
      <div className="v4homeMeta">
        <span>到期 <b>{h.due}</b></span>
        <span>未掌握 <b>{h.weak}</b></span>
        <span>钉子 <b>{h.nails}</b></span>
        <span>毕业 <b>{h.master}</b></span>
      </div>

      {/* 只提示一条，别叠两张黄条。清账期优先——它解释了「为什么没有新词」 */}
      {plan.tier === 'settle' && !done ? (
        <div className="v4homeWarn">
          有 <b>{h.due}</b> 个词到期，正在清账期（新词暂停）。今天清 <b>{plan.dueN}</b> 个
          {plan.dueN >= h.due ? '，一次清完。' : `，剩下 ${h.due - plan.dueN} 个明天接着清。`}
        </div>
      ) : gap >= 2 && !done ? (
        <div className="v4homeWarn">
          停了 {gap} 天。到期词不会消失，今天从最该做的开始，不用补课。
        </div>
      ) : null}

      <button className="btn v4homeGo" onClick={() => nav('/today')}>
        {done ? '✓ 已完成 · 再练一组' : started ? `▶ 继续（还剩 ${Math.max(0, mustAll - (log?.mustDone || 0))} 题）` : `▶ 开始 · ${plan.segs.filter(s => s.k !== 'wrap').length} 段 · 约 ${plan.estMin} 分钟`}
      </button>

      {!done && (
        <div className="v4homeFoot">
          把 {mustAll} 道必做题做完就算完成，不用凑时长；看答案的题不超过 40%。
          {plan.maxMin > plan.minMin ? ` 最多 ${plan.maxMin} 分钟封顶，慢慢做不会加量。` : ''}
        </div>
      )}

      {/* 爬坡提示：默认已关闭（cfg.rampOn=false），家长手动打开才出现 */}
      {week < 2 && !plan.weekend && !done && (
        <div className="v4homeRamp">
          第 {plan.rampWeek + 1} 周先 {plan.minMin} 分钟。
        </div>
      )}
    </div>
  )
}
