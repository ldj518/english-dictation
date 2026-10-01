import { useEffect, useState } from 'react'

/**
 * 音频播放失败的全局提示条。
 *
 * 此前播放失败被静默吞掉（用户感知就是「没声音」却查不到原因）。
 * 现在 player.ts 在两处失败点广播 eng-dict-audio-fail 事件：
 *   - load-failed      音频文件加载失败（网络/域名不通）
 *   - autoplay-blocked 自动播放被浏览器拦截（没点过「开始」）
 * 本组件挂全局监听，显示一条 3.5 秒的提示。
 */
export default function AudioFailToast() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: number | undefined
    const onFail = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail
      setMsg(
        kind === 'load-failed'
          ? '⚠️ 音频加载失败，请检查网络后重试'
          : '⚠️ 声音被浏览器拦住了，先点一下屏幕再试'
      )
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(null), 3500)
    }
    window.addEventListener('eng-dict-audio-fail', onFail)
    return () => {
      window.removeEventListener('eng-dict-audio-fail', onFail)
      window.clearTimeout(timer)
    }
  }, [])

  if (!msg) return null
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 78,
        transform: 'translateX(-50%)',
        zIndex: 999,
        background: 'var(--ink)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
        padding: '10px 16px',
        borderRadius: 12,
        boxShadow: '0 6px 20px rgba(0,0,0,.25)',
        maxWidth: '86vw',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      role="alert"
    >
      {msg}
    </div>
  )
}
