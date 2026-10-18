import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { usePostingGate } from '../auth/usePostingGate'
import { Avatar } from './Avatar'
import { Logo } from './Logo'

export function Header() {
  const { user, status, logout } = useAuth()
  const needVerify = usePostingGate()
  const navigate = useNavigate()
  const location = useLocation()
  const [term, setTerm] = useState('')
  const [unread, setUnread] = useState(0)

  const isMe = location.pathname.startsWith('/me')
  const isNotifications = location.pathname.startsWith('/notifications')

  useEffect(() => {
    if (!user) {
      setUnread(0)
      return
    }
    let alive = true
    const load = () => {
      api
        .myNotifications()
        .then((res) => {
          if (alive) setUnread(res.unread)
        })
        .catch(() => {
          // 顶栏角标失败不影响页面
        })
    }
    void load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('notifications:changed', load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('notifications:changed', load)
    }
  }, [user, location.pathname])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    const q = term.trim()
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/')
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />

        <nav className="header-nav" aria-label="主导航">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
            广场
          </Link>
          {user ? (
            <Link to="/me" className={isMe ? 'active' : ''}>
              我的
            </Link>
          ) : null}
          {user?.role === 'admin' ? (
            <Link to="/admin" className={location.pathname.startsWith('/admin') ? 'active' : ''}>
              管理
            </Link>
          ) : null}
        </nav>

        <form className="header-search" role="search" onSubmit={onSearch}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="搜一个正在纠结的问题"
            aria-label="搜索问题"
          />
        </form>

        <div className="header-actions">
          {user ? (
            <Link
              to="/notifications"
              className={`icon-btn notification-bell${isNotifications ? ' active' : ''}`}
              aria-label={unread ? `通知，${unread} 条未读` : '通知'}
              title="通知"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
              {unread > 0 ? (
                <span className="notification-count">{unread > 99 ? '99+' : unread}</span>
              ) : null}
            </Link>
          ) : null}

          <Link
            to={needVerify ? '/settings#email' : '/?compose=1'}
            className="btn btn-primary btn-sm header-publish"
            title={needVerify ? '验证邮箱后才能发起投票' : undefined}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            发起投票
          </Link>

          {status === 'loading' ? (
            <span className="header-avatar-skeleton" aria-hidden="true" />
          ) : user ? (
            <details className="menu">
              <summary aria-label="账号菜单">
                <Avatar name={user.username} hue={user.avatarHue} size={34} />
              </summary>
              <div className="menu-panel">
                <div className="menu-user">
                  <strong>{user.username}</strong>
                  <span>{user.email}</span>
                </div>
                <Link to="/me">我的决定</Link>
                <Link to="/me?tab=votes">我参与的</Link>
                <Link to="/settings">账号设置</Link>
                {user.role === 'admin' ? <Link to="/admin">管理后台</Link> : null}
                <button
                  type="button"
                  onClick={async () => {
                    await logout()
                    navigate('/login')
                  }}
                >
                  退出登录
                </button>
              </div>
            </details>
          ) : (
            <Link to="/login" className="btn btn-ghost btn-sm">
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
