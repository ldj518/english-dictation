import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { loadBookWords } from '../lib/data'

/**
 * 游戏中心（v2.6）：把「学过的词」和「错题本」变成游戏素材。
 * - 词义连连看：学过的词英中配对消除，练反应和词义
 * - 错词大作战：错题本里的词当怪兽，答对一只消灭一只（复习的游戏化皮肤，
 *   答题走 recordReview，推进遗忘曲线，和错词本复习完全同源）
 */
export default function Games() {
  const nav = useNavigate()
  const { progress } = useStore()
  const [stats, setStats] = useState<{ learned: number; bookName: string } | null>(null)

  const wrongCount = Object.keys(progress.wrong).length
  const learned = progress.planDone * 10

  useEffect(() => {
    let cancel = false
    void loadBookWords().then(b => {
      if (!cancel) setStats({ learned: b.words.length, bookName: b.name })
    })
    return () => { cancel = true }
  }, [])

  return (
    <Shell title="游戏中心" back>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>🎮 用学过的词来玩</div>
        <div className="sub small" style={{ lineHeight: 1.7 }}>
          游戏里出现的都是学过的词和错题本里的词，没学过的不会冒出来。
          赢到的积分和答题记录都会正常计入学习进度。
        </div>
      </div>

      <button className={'cell' + (wrongCount ? '' : '')} style={{ width: '100%', textAlign: 'left', marginBottom: 12 }}
        onClick={() => nav('/games/match')}>
        <div className="n" style={{ fontSize: 16 }}>🧩 词义连连看</div>
        <div className="t">英文卡配中文卡，配对消除 · 连击有奖励</div>
        <div className="t" style={{ marginTop: 6, color: 'var(--ok)' }}>
          词池：学过的 {Math.max(learned, 6)} 词{stats ? ` · ${stats.bookName}` : ''}
        </div>
      </button>

      <button className="cell" style={{ width: '100%', textAlign: 'left' }}
        onClick={() => nav('/games/monster')}>
        <div className="n" style={{ fontSize: 16 }}>👾 错词大作战</div>
        <div className="t">错题本里的词变成怪兽，答对一只消灭一只</div>
        <div className="t" style={{ marginTop: 6, color: wrongCount ? 'var(--bad)' : 'var(--sub)' }}>
          {wrongCount ? `当前 ${wrongCount} 只怪兽等你消灭` : '错题本空空的——先去听写攒几只'}
        </div>
      </button>

      {stats && (
        <div className="sub small center" style={{ marginTop: 14 }}>
          当前词库：{stats.bookName} · 共 {stats.learned} 词
        </div>
      )}
    </Shell>
  )
}
