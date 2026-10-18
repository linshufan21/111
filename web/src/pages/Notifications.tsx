import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { UserNotification } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Layout } from '../components/Layout'
import { timeAgo } from '../lib/format'
import {
  notificationHref,
  notificationKindLabel,
  notificationText,
  notificationTone,
} from '../lib/notifications'

export function Notifications() {
  const { user, status } = useAuth()
  const [items, setItems] = useState<UserNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let alive = true
    setLoading(true)
    setError('')
    api
      .myNotifications()
      .then((res) => {
        if (!alive) return
        setItems(res.items)
        setUnread(res.unread)
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '通知加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user])

  async function markAllRead() {
    if (!unread) return
    setBusy(true)
    try {
      await api.markNotificationsRead()
      setUnread(0)
      setItems((list) =>
        list.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      )
      window.dispatchEvent(new Event('notifications:changed'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '标记已读失败')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <Layout>
        <div className="notifications-shell">
          <div className="skeleton skeleton-title" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return <Navigate to="/login?next=/notifications" replace />
  }

  return (
    <Layout>
      <div className="notifications-shell">
        <header className="notifications-head">
          <div>
            <p className="eyebrow">INBOX</p>
            <h1>通知中心</h1>
            <p className="muted">
              {unread ? `${unread} 条未读` : '所有通知都看过了'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!unread || busy}
            onClick={() => void markAllRead()}
          >
            {busy ? '处理中…' : '全部已读'}
          </button>
        </header>

        {loading ? (
          <p className="muted">正在整理通知…</p>
        ) : error ? (
          <div className="state-card" role="alert">
            <h3>加载失败</h3>
            <p>{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="state-card">
            <h3>还没有通知</h3>
            <p>有人参与你的问题、你的问题截止，或举报有结果时，会出现在这里。</p>
            <Link to="/" className="btn btn-primary btn-sm">
              去广场看看
            </Link>
          </div>
        ) : (
          <div className="notification-list">
            {items.map((notice) => (
              <Link
                key={notice.id}
                to={notificationHref(notice)}
                className={`notification-item${notice.readAt ? '' : ' unread'}`}
              >
                <span className={`notification-mark ${notificationTone(notice.type)}`}>
                  {notificationKindLabel(notice.type)}
                </span>
                <span className="notification-main">
                  <span className="notification-meta">
                    {notificationKindLabel(notice.type)} · {timeAgo(notice.createdAt)}
                  </span>
                  <span className="notification-text">{notificationText(notice)}</span>
                </span>
                {notice.readAt ? null : <i className="notification-dot" aria-label="未读" />}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
