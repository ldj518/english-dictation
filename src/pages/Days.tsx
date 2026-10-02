import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { DAILY } from '../lib/data'

/**
 * 选日子（v3.3）：48 天词单全景网格。
 *
 * 顺序引导是默认路径（首页每日计划），但这页给孩子掌控感：
 * 想跳着学、想回头重刷哪一天都行，复习队列和掌握度地图照常工作。
 * 每格显示完成状态 / 最佳成绩 / 首次完成日期，「下一个该做的」高亮。
 */
export default function Days() {
  const nav = useNavigate()
  const { progress } = useStore()
  const nextDay = (progress.planDone || 0) + 1

  return (
    <Shell title="选日子" back sub={`${DAILY.length} 天自由学`}>
      <div className="sub small" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        想跳着学、想回头重刷哪一天都可以。没做过的日子不会消失，漏掉的词复习队列也会自动安排。
      </div>
      <div className="grid">
        {DAILY.map(t => {
          const best = progress.best[t.id]
          const doneDate = progress.planLog?.[t.order]
          const cls = !best ? '' : best.score >= 90 ? 's100' : best.score >= 60 ? 's60' : 's0'
          const isNext = t.order === nextDay
          return (
            <button
              key={t.id}
              className={'cell' + (best ? ' done' : '')}
              style={isNext ? { outline: '2px solid #378add', outlineOffset: 2 } : undefined}
              onClick={() => nav(`/d/${t.id}`)}
              title={isNext ? '今天该做的一天' : `第 ${t.order} 天`}
            >
              <div className="n">第 {t.order} 天{isNext ? ' ·⭐' : ''}</div>
              <div className="t">{t.wordCount} 词</div>
              {best ? <div className={'s ' + cls}>{best.score}%</div> : <div className="t">未做</div>}
              {doneDate && (
                <div className="sub" style={{ fontSize: 10, marginTop: 2 }}>{doneDate.slice(5)} 完成</div>
              )}
            </button>
          )
        })}
      </div>
    </Shell>
  )
}
