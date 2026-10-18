import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Question, Report, UserNotification } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Layout } from '../components/Layout'
import { QuestionCard } from '../components/QuestionCard'
import { fullDate, timeAgo } from '../lib/format'
import { notificationText } from '../lib/notifications'
import { reportReasonLabel, reportStatusLabel } from '../lib/reports'

type Tab = 'questions' | 'votes' | 'reports'

export function Me() {
  const { user, status } = useAuth()
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab: Tab = rawTab === 'votes' || rawTab === 'reports' ? rawTab : 'questions'

  const [items, setItems] = useState<Question[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [notices, setNotices] = useState<UserNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let alive = true
    api
      .myNotifications()
      .then((res) => {
        if (!alive) return
        setNotices(res.items)
        setUnread(res.unread)
      })
      .catch(() => {
        // 通知是增强信息，失败不打断“我的”页面
      })
    return () => {
      alive = false
    }
  }, [user])

  async function markAllRead() {
    try {
      await api.markNotificationsRead()
      setUnread(0)
      setNotices((list) =>
        list.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      )
    } catch {
      // 忽略：下次进入页面会重试
    }
  }

  useEffect(() => {
    if (!user) return
    let alive = true
    setLoading(true)
    setError('')
    if (tab === 'reports') {
      api
        .myReports()
        .then((res) => {
          if (alive) setReports(res.items)
        })
        .catch((err) => {
          if (alive) setError(err instanceof ApiError ? err.message : '加载失败')
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    } else {
      const request = tab === 'votes' ? api.myVotes() : api.myQuestions()
      request
        .then((res) => {
          if (alive) setItems(res.items)
        })
        .catch((err) => {
          if (alive) setError(err instanceof ApiError ? err.message : '加载失败')
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    return () => {
      alive = false
    }
  }, [tab, user])

  if (status === 'loading') {
    return (
      <Layout>
        <div className="me-shell">
          <div className="skeleton skeleton-title" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return <Navigate to="/login?next=/me" replace />
  }

  function switchTab(next: Tab) {
    const search = new URLSearchParams(params)
    if (next === 'questions') search.delete('tab')
    else search.set('tab', next)
    setParams(search)
  }

  function updateQuestion(next: Question) {
    setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)))
  }

  return (
    <Layout>
      <div className="me-shell">
        <header className="me-head">
          <div>
            <p className="eyebrow">MY DECISIONS</p>
            <h1>{user.username} 的决定</h1>
            <p className="muted">{user.email}</p>
          </div>
          <Link to="/?compose=1" className="btn btn-primary">
            发起新投票
          </Link>
        </header>

        {unread > 0 && notices.some((notice) => !notice.readAt) ? (
          <div className="notice-banner" role="status">
            <div>
              <strong>
                举报处理结果
                {unread > 1 ? ` · ${unread} 条未读` : ''}
              </strong>
              <p>{notificationText(notices.find((notice) => !notice.readAt)!)}</p>
            </div>
            <div className="notice-actions">
              <Link to="/me?tab=reports" className="text-btn">
                查看我的举报
              </Link>
              <button type="button" className="text-btn" onClick={() => void markAllRead()}>
                知道了
              </button>
            </div>
          </div>
        ) : null}

        <div className="segment me-tabs" role="tablist" aria-label="我的内容">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'questions'}
            className={`segment-item${tab === 'questions' ? ' on' : ''}`}
            onClick={() => switchTab('questions')}
          >
            我发起的
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'votes'}
            className={`segment-item${tab === 'votes' ? ' on' : ''}`}
            onClick={() => switchTab('votes')}
          >
            我参与的
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reports'}
            className={`segment-item${tab === 'reports' ? ' on' : ''}`}
            onClick={() => switchTab('reports')}
          >
            我的举报
          </button>
        </div>

        {loading ? (
          <p className="muted">正在翻你的记录…</p>
        ) : error ? (
          <div className="state-card" role="alert">
            <h3>加载失败</h3>
            <p>{error}</p>
          </div>
        ) : tab === 'reports' ? (
          reports.length === 0 ? (
            <div className="state-card">
              <h3>你还没有举报过问题</h3>
              <p>在问题详情页发现广告、攻击或隐私内容时，可以交给管理员处理。</p>
              <Link to="/" className="btn btn-primary btn-sm">
                去广场看看
              </Link>
            </div>
          ) : (
            <div className="report-list">
              {reports.map((report) => (
                <article className="report-item" key={report.id}>
                  <div className="report-item-head">
                    <span className={`tag report-status report-${report.status}`}>
                      {reportStatusLabel(report.status)}
                    </span>
                    <span className="report-reason-label">{reportReasonLabel(report.reason)}</span>
                    <span className="muted">{timeAgo(report.createdAt)}</span>
                  </div>
                  {report.question ? (
                    <Link to={`/q/${report.question.id}`} className="report-question">
                      {report.question.title}
                    </Link>
                  ) : (
                    <strong className="report-question">问题已删除</strong>
                  )}
                  {report.detail ? <p className="report-detail">{report.detail}</p> : null}
                  {report.handledAt ? (
                    <p className="muted report-handled">
                      处理时间：{fullDate(report.handledAt)}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="state-card">
            <h3>{tab === 'questions' ? '你还没有发起过投票' : '你还没有参与过投票'}</h3>
            <p>
              {tab === 'questions'
                ? '把正在纠结的事写下来，让陌生人给你一点参考。'
                : '去广场看看，投出你的第一票并留下理由。'}
            </p>
            <Link to={tab === 'questions' ? '/?compose=1' : '/'} className="btn btn-primary btn-sm">
              {tab === 'questions' ? '发起第一个问题' : '去广场投票'}
            </Link>
          </div>
        ) : (
          <div className="feed-list">
            {items.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                onUpdate={updateQuestion}
                compact
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
