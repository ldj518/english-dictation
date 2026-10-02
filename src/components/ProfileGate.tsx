import { useState } from 'react'
import { useStore } from '../lib/store'
import { deviceOwner } from '../lib/storage'

/**
 * 启动选人门（v3.3）。
 *
 * 多台设备共用应用时，数据本身按孩子身份分开存（不会混），
 * 真正的风险是「设备不知道现在是谁在用」——弟弟拿平板点开，
 * 默认还是上次用的人，做的题全记到别人头上。
 *
 * 解法：这台设备还没选过人时，全屏问一次「今天谁学？」，
 * 点大头像进入并记住；之后每次打开直接进。换人走首页/设置页的
 * 身份按钮（ProfileSwitcher 弹层，switchProfile 会同步更新设备主人标记）。
 */
export default function ProfileGate({ children }: { children: React.ReactNode }) {
  const { profiles, switchProfile } = useStore()
  const [owner, setOwner] = useState<string | null>(() => {
    // SSR / 冒烟测试环境（无 window）直接放行，否则所有页面渲染都会变成选人页
    if (typeof window === 'undefined') return '__ssr__'
    const saved = deviceOwner()
    // 记的人已被删除（如重置过身份）→ 重新选
    return saved && profiles.some(p => p.id === saved) ? saved : null
  })

  // 分享页免选人：家人在微信里点开 /s/xxx 链接是查看，不该被「今天谁学」拦住
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/s/')) {
    return <>{children}</>
  }

  const pick = (id: string) => {
    switchProfile(id)
    setOwner(id)
  }

  if (owner) return <>{children}</>

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ fontSize: 44, lineHeight: 1 }}>👋</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10 }}>今天谁学？</div>
      <div className="sub" style={{ marginTop: 6, marginBottom: 26 }}>
        点自己的头像开始，这台设备会记住
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => pick(p.id)}
            style={{
              width: 148, padding: '22px 12px', borderRadius: 16,
              border: `2px solid ${p.color}`, background: p.color + '10',
              cursor: 'pointer', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 46, lineHeight: 1 }}>{p.emoji}</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 10 }}>{p.name}</div>
          </button>
        ))}
      </div>
      <div className="sub small" style={{ marginTop: 28 }}>
        用错了也没关系：首页点自己的名字随时换人
      </div>
    </div>
  )
}
