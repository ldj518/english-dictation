import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { WORDS } from '../lib/data'
import { todayStr } from '../lib/storage'
import { seededShuffle, makeSeed } from '../lib/shuffle'

/**
 * 专项（v3.5）：与每日闯关主线并行的加练工具。
 * 短语专项 / 智能混合卷是每天可做的固定动作，词形 / 地图 / 训练场按需用。
 */
export default function Extra() {
  const nav = useNavigate()
  const { profile } = useStore()

  return (
    <Shell title="🧰 专项加练" back>
      <div className="sub small" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        闯关之外的补充弹药。建议每天：一张混合卷 + 一组短语，别的按弱项来。
      </div>

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

      {/* 按需工具 */}
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>📝 按需练习</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/forms/all')}>📝 词形变换</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/map')}>🗺️ 掌握地图</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/train')}>🎯 训练场</button>
          <button className="btn ghost sm" style={{ flex: '1 1 46%' }} onClick={() => nav('/review')}>📕 错词本</button>
        </div>
      </div>
    </Shell>
  )
}
