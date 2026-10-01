import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isUnlocked, verifyPin, lockNow } from '../lib/parentLock'

/**
 * 家长解锁门禁。
 *
 * 用法：<PinGate>受保护内容</PinGate>
 * - 已解锁（30 分钟窗口内）→ 直接渲染 children
 * - 未解锁 → 渲染输码卡片，校验通过后显示 children
 *
 * 保护对象：答案版卷面（PrintSheet）、纸质批改对照（Paper）。
 * 码只在云端校验，本机不落任何痕迹。
 */
export default function PinGate({ children, title = '家长解锁' }: {
  children: React.ReactNode
  title?: string
}) {
  const [unlocked, setUnlocked] = useState(() => isUnlocked())
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  if (unlocked) {
    return (
      <>
        {children}
        <div className="no-print center" style={{ marginTop: 10 }}>
          <button
            className="btn ghost sm"
            onClick={() => { lockNow(); setUnlocked(false) }}
          >🔒 重新上锁</button>
        </div>
      </>
    )
  }

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) { setMsg('解锁码是 4-6 位数字'); return }
    setBusy(true)
    setMsg('')
    const r = await verifyPin(pin)
    setBusy(false)
    if (r.ok) { setUnlocked(true); return }
    setMsg(r.msg)
    setPin('')
  }

  return (
    <div className="card pad center no-print" style={{ maxWidth: 420, margin: '30px auto' }}>
      <div style={{ fontSize: 34 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 16, margin: '8px 0 4px' }}>{title}</div>
      <div className="sub small" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        这里是批改 / 答案内容，需要家长输入解锁码。<br />
        没设过？到 <Link to="/parent" style={{ color: 'var(--blue)' }}>家长看板</Link> 设置一个 4-6 位数字码。
      </div>
      <input
        className="pinInput"
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="····"
        aria-label="家长解锁码"
        autoFocus
      />
      <button className="btn" style={{ marginTop: 12, minWidth: 120 }} onClick={submit} disabled={busy || pin.length < 4}>
        {busy ? '校验中…' : '解锁'}
      </button>
      {msg && (
        <div className="sub small" style={{ marginTop: 10, color: 'var(--bad)', fontWeight: 600 }}>{msg}</div>
      )}
    </div>
  )
}
