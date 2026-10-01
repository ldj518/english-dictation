import { useNavigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

interface ShellProps {
  title: string
  children: ReactNode
  back?: boolean
  right?: ReactNode
  /** 隐藏底部导航（答题页用） */
  noNav?: boolean
  sub?: string
}

const NAV = [
  { to: '/', i: '🏠', t: '首页' },
  { to: '/review', i: '🔁', t: '错词本' },
  { to: '/words', i: '📚', t: '词库' },
  { to: '/stats', i: '📈', t: '我的' },
]

export default function Shell({ title, children, back, right, noNav, sub }: ShellProps) {
  const nav = useNavigate()
  const loc = useLocation()

  return (
    <>
      <header>
        <div className="hd">
          {back && (
            <button className="iconbtn" onClick={() => nav(-1)} aria-label="返回">‹ 返回</button>
          )}
          <h1>{title}</h1>
          {sub && <span className="sp">{sub}</span>}
          {right}
        </div>
      </header>
      <div className="wrap">{children}</div>
      {!noNav && (
        <nav className="tabbar">
          {NAV.map(n => (
            <button
              key={n.to}
              className={'tb' + (loc.pathname === n.to ? ' on' : '')}
              onClick={() => nav(n.to)}
            >
              <span className="i">{n.i}</span>
              <span>{n.t}</span>
            </button>
          ))}
        </nav>
      )}
    </>
  )
}
