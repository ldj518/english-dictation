import { unlockAudio } from '../lib/player'

/**
 * 音频开始门：自动播放在微信内置浏览器会被静默拦截（无用户手势链），
 * 所以所有会自动读词的练习页，第一次都要先点一下「开始」。
 *
 * 点按 = 真实手势 → unlockAudio() 解锁播放通道 → 页面再开始自动读词。
 * 桌面浏览器多这一下也不亏：孩子有个「准备好了」的仪式感，不会漏听第一题。
 */
export default function AudioGate({ onStart, title = '准备好了吗？', tip }: {
  onStart: () => void
  title?: string
  tip?: string
}) {
  return (
    <div className="card pad center" style={{ maxWidth: 420, margin: '30px auto' }}>
      <div style={{ fontSize: 44 }}>🔊</div>
      <div style={{ fontWeight: 800, fontSize: 18, margin: '10px 0 6px' }}>{title}</div>
      <div className="sub small" style={{ marginBottom: 16, lineHeight: 1.8 }}>
        {tip || '点下面的按钮开始，系统会自动读单词。'}
        <br />
        微信里第一次点一下，后面就有声音了。
      </div>
      <button
        className="btn"
        style={{ minWidth: 220, minHeight: 52, fontSize: 17 }}
        onClick={() => { unlockAudio(); onStart() }}
      >
        ▶ 点我开始
      </button>
    </div>
  )
}
