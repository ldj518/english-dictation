import { useState } from 'react'
import { useStore } from '../lib/store'

/**
 * 身份切换器（v3.3.2 隔离规则的标准实现）：
 * - 平面只显示当前孩子，绝不并列列出其他孩子（防「顶部显示两个用户」的混感）
 * - 切人必须走弹层，且弹层里当前孩子只是标注、点不出动作（防误触）
 * - switchProfile 会同时改设备归属（deviceOwner），所以任何新入口
 *   想加"换人"都必须用这个组件，不要自己裸调 switchProfile。
 */
export default function ProfileSwitcher() {
  const { profiles, profile, switchProfile } = useStore()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="pChip on me"
        style={{ borderColor: profile.color, background: profile.color + '14' }}
        onClick={() => setOpen(true)}
        aria-label={`当前身份：${profile.name}，点按切换`}
      >
        <span className="pe">{profile.emoji}</span>
        <span className="pn">{profile.name}</span>
        <span className="psub">切换 ›</span>
      </button>

      {open && (
        <div className="ovl" onClick={() => setOpen(false)}>
          <div className="ovlCard" onClick={e => e.stopPropagation()}>
            <div className="ovlT">现在是谁学？</div>
            {profiles.map(p => (
              <button
                key={p.id}
                className={'swRow' + (p.id === profile.id ? ' cur' : '')}
                style={{ borderColor: p.color }}
                onClick={() => {
                  setOpen(false)
                  if (p.id !== profile.id) switchProfile(p.id)
                }}
              >
                <span className="pe">{p.emoji}</span>
                <span className="pn">{p.name}</span>
                {p.id === profile.id ? (
                  <span className="curTag">当前</span>
                ) : (
                  <span className="swGo">切换到这 ›</span>
                )}
              </button>
            ))}
            <div className="sub small" style={{ marginTop: 10, lineHeight: 1.7 }}>
              每个人的学习记录分开记、互不混。这台设备会记住本次选择，下次打开直接进。
            </div>
          </div>
        </div>
      )}
    </>
  )
}
