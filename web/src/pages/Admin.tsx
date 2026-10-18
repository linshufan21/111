import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type {
  AdminQuestion,
  AdminReport,
  AdminStats,
  AdminUser,
  AuditLog,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Layout } from '../components/Layout'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { fullDate, timeAgo } from '../lib/format'
import { reportReasonLabel, reportStatusLabel } from '../lib/reports'

type Tab = 'overview' | 'questions' | 'users' | 'reports' | 'audit'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'questions', label: '内容管理' },
  { key: 'users', label: '用户管理' },
  { key: 'reports', label: '举报' },
  { key: 'audit', label: '审计日志' },
]

const REPORT_STATUS_TABS = [
  { value: 'pending', label: '待处理' },
  { value: 'resolved', label: '已处理' },
  { value: 'rejected', label: '已驳回' },
  { value: 'all', label: '全部' },
]

const AUDIT_CATEGORIES = [
  { value: 'all', label: '全部动作' },
  { value: 'content', label: '内容管理' },
  { value: 'users', label: '用户管理' },
  { value: 'auth', label: '认证与安全' },
  { value: 'admin', label: '全部管理操作' },
]

const ACTION_LABELS: Record<string, string> = {
  'auth.register': '注册账号',
  'auth.login.success': '登录成功',
  'auth.login.failed': '登录失败',
  'auth.login.locked': '登录锁定',
  'auth.password.change': '修改密码',
  'auth.password.reset_requested': '申请重置密码',
  'auth.password.reset': '重置密码',
  'admin.question.featured': '设为精选',
  'admin.question.unfeatured': '取消精选',
  'admin.question.closed': '截止问题',
  'admin.question.reopened': '重开问题',
  'admin.question.deleted': '删除问题',
  'admin.user.banned': '停用用户',
  'admin.user.unbanned': '恢复用户',
  'admin.report.resolved': '处理举报',
  'admin.report.rejected': '驳回举报',
  'admin.report.question_deleted': '删除被举报问题',
  'admin.report.author_banned': '停用被举报作者',
  'report.created': '提交举报',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

function targetLabel(log: AuditLog) {
  const title = typeof log.meta.title === 'string' ? log.meta.title : ''
  const username = typeof log.meta.username === 'string' ? log.meta.username : ''
  if (log.targetType === 'question') return title || log.targetId || '问题'
  if (log.targetType === 'user') {
    if (username) return `@${username}`
    if (log.actor) return `@${log.actor.username}`
    return log.targetId || '用户'
  }
  return log.targetId || '—'
}

export function Admin() {
  const { user, status } = useAuth()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab: Tab =
    rawTab === 'questions' ||
    rawTab === 'users' ||
    rawTab === 'reports' ||
    rawTab === 'audit'
      ? rawTab
      : 'overview'

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [questions, setQuestions] = useState<AdminQuestion[]>([])
  const [questionTotal, setQuestionTotal] = useState(0)
  const [questionPage, setQuestionPage] = useState(1)
  const [questionQ, setQuestionQ] = useState('')
  const [questionStatus, setQuestionStatus] = useState('all')
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [questionError, setQuestionError] = useState('')

  const [users, setUsers] = useState<AdminUser[]>([])
  const [userQ, setUserQ] = useState('')
  const [usersLoading, setUsersLoading] = useState(true)
  const [userError, setUserError] = useState('')
  const [busyId, setBusyId] = useState('')

  const [reportItems, setReportItems] = useState<AdminReport[]>([])
  const [reportTotal, setReportTotal] = useState(0)
  const [reportPage, setReportPage] = useState(1)
  const [reportStatus, setReportStatus] = useState('pending')
  const [reportSort, setReportSort] = useState('new')
  const [reportQ, setReportQ] = useState('')
  const [reportQuery, setReportQuery] = useState('')
  const [reportNonce, setReportNonce] = useState(0)
  const [reportsLoading, setReportsLoading] = useState(true)
  const [reportError, setReportError] = useState('')
  const [reportCounts, setReportCounts] = useState({ pending: 0, resolved: 0, rejected: 0 })

  const [audits, setAudits] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditQ, setAuditQ] = useState('')
  const [auditQuery, setAuditQuery] = useState('')
  const [auditCategory, setAuditCategory] = useState('all')
  const [auditNonce, setAuditNonce] = useState(0)
  const [auditsLoading, setAuditsLoading] = useState(true)
  const [auditError, setAuditError] = useState('')
  const [auditDetail, setAuditDetail] = useState<AuditLog | null>(null)

  const isAdmin = user?.role === 'admin'

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const data = await api.admin.stats()
      setStats(data)
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '统计加载失败', 'error')
    } finally {
      setStatsLoading(false)
    }
  }, [notify])

  const loadQuestions = useCallback(async () => {
    setQuestionsLoading(true)
    setQuestionError('')
    try {
      const data = await api.admin.questions({
        q: questionQ,
        status: questionStatus,
        page: questionPage,
      })
      setQuestions(data.items)
      setQuestionTotal(data.total)
    } catch (err) {
      setQuestionError(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      setQuestionsLoading(false)
    }
  }, [questionQ, questionStatus, questionPage])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUserError('')
    try {
      const data = await api.admin.users(userQ)
      setUsers(data.items)
    } catch (err) {
      setUserError(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      setUsersLoading(false)
    }
  }, [userQ])

  const loadReports = useCallback(async () => {
    setReportsLoading(true)
    setReportError('')
    try {
      const data = await api.admin.reports({
        status: reportStatus,
        sort: reportSort,
        q: reportQuery,
        page: reportPage,
      })
      setReportItems(data.items)
      setReportTotal(data.total)
      setReportCounts(data.counts)
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : '举报队列加载失败')
    } finally {
      setReportsLoading(false)
    }
  }, [reportStatus, reportSort, reportQuery, reportPage])

  const loadAudits = useCallback(async () => {
    setAuditsLoading(true)
    setAuditError('')
    try {
      const data = await api.admin.audit({
        q: auditQuery,
        category: auditCategory,
        page: auditPage,
        limit: 20,
      })
      setAudits(data.items)
      setAuditTotal(data.total)
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : '审计日志加载失败')
    } finally {
      setAuditsLoading(false)
    }
  }, [auditQuery, auditCategory, auditPage])

  useEffect(() => {
    if (isAdmin) void loadStats()
  }, [isAdmin, loadStats])

  useEffect(() => {
    if (!isAdmin || tab !== 'questions') return
    void loadQuestions()
  }, [isAdmin, tab, loadQuestions])

  useEffect(() => {
    if (!isAdmin || tab !== 'users') return
    void loadUsers()
  }, [isAdmin, tab, loadUsers])

  useEffect(() => {
    if (!isAdmin || tab !== 'reports') return
    void loadReports()
  }, [isAdmin, tab, loadReports, reportNonce])

  useEffect(() => {
    if (!isAdmin || tab !== 'audit') return
    void loadAudits()
  }, [isAdmin, tab, loadAudits, auditNonce])

  if (status === 'loading') {
    return (
      <Layout>
        <div className="admin-shell">
          <div className="skeleton skeleton-title lg" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return <Navigate to="/login?next=/admin" replace />
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="state-card not-found">
          <p className="eyebrow">403</p>
          <h1>这里需要管理员权限</h1>
          <p>当前账号是普通用户。请用管理员账号登录后再访问。</p>
          <Link to="/" className="btn btn-primary btn-sm">
            回到广场
          </Link>
        </div>
      </Layout>
    )
  }

  function switchTab(next: Tab) {
    const search = new URLSearchParams(params)
    if (next === 'overview') search.delete('tab')
    else search.set('tab', next)
    setParams(search)
  }

  async function toggleFeatured(q: AdminQuestion) {
    setBusyId(q.id)
    try {
      await api.admin.updateQuestion(q.id, { featured: !q.featured })
      setQuestions((list) =>
        list.map((item) => (item.id === q.id ? { ...item, featured: !item.featured } : item)),
      )
      notify(q.featured ? '已取消精选' : '已设为精选', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  async function toggleClosed(q: AdminQuestion) {
    setBusyId(q.id)
    const close = q.status === 'open'
    try {
      await api.admin.updateQuestion(q.id, { closed: close })
      setQuestions((list) =>
        list.map((item) =>
          item.id === q.id ? { ...item, status: close ? 'closed' : 'open' } : item,
        ),
      )
      notify(close ? '已截止该问题' : '已重新开放', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  async function removeQuestion(q: AdminQuestion) {
    if (!window.confirm(`确定删除「${q.title}」？该问题的投票与理由会一并删除。`)) return
    setBusyId(q.id)
    try {
      await api.admin.deleteQuestion(q.id)
      setQuestions((list) => list.filter((item) => item.id !== q.id))
      setQuestionTotal((n) => Math.max(0, n - 1))
      notify('问题已删除', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '删除失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  async function handleReport(
    report: AdminReport,
    action: 'resolve' | 'reject' | 'delete_question' | 'ban_author',
  ) {
    const title = report.question?.title ?? report.questionTitle
    const author = report.question?.author?.username
    if (action === 'delete_question') {
      if (!window.confirm(`删除「${title}」？问题及投票会一并删除，相关举报会被标记处理。`)) return
    }
    if (action === 'ban_author') {
      if (!window.confirm(`停用作者${author ? `「${author}」` : ''}？该用户会立即退出登录。`)) return
    }
    if (action === 'reject') {
      if (!window.confirm('驳回这条举报？')) return
    }
    setBusyId(report.id)
    try {
      await api.admin.handleReport(report.id, action)
      const message = {
        resolve: '已标记为处理完成',
        reject: '已驳回举报',
        delete_question: '已删除问题，并通知举报人',
        ban_author: '已停用作者，并通知举报人',
      }[action]
      notify(message, 'success')
      setReportPage(1)
      setReportNonce((n) => n + 1)
      void loadStats()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  async function toggleUser(u: AdminUser) {
    const ban = u.status === 'active'
    if (ban && !window.confirm(`停用「${u.username}」？该用户会立即退出登录。`)) return
    setBusyId(u.id)
    try {
      await api.admin.setUserStatus(u.id, ban ? 'banned' : 'active')
      setUsers((list) =>
        list.map((item) =>
          item.id === u.id ? { ...item, status: ban ? 'banned' : 'active' } : item,
        ),
      )
      notify(ban ? '已停用该用户' : '已恢复该用户', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const maxCategory = Math.max(...(stats?.categories.map((c) => c.count) ?? [1]))

  return (
    <Layout>
      <div className="admin-shell">
        <aside className="admin-side">
          <div className="admin-side-head">
            <span className="eyebrow">ADMIN</span>
            <h1>管理台</h1>
            <p>@{user.username}</p>
          </div>
          <nav aria-label="管理导航">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`admin-nav-item${tab === t.key ? ' on' : ''}`}
                onClick={() => switchTab(t.key)}
              >
                {t.label}
                {t.key === 'reports' && stats?.stats.pendingReports ? (
                  <span className="admin-nav-badge">{stats.stats.pendingReports}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="admin-side-foot">
            <Link to="/">← 回到广场</Link>
          </div>
        </aside>

        <main className="admin-main">
          {tab === 'overview' ? (
            <section aria-labelledby="admin-overview">
              <header className="admin-head">
                <div>
                  <p className="eyebrow">OVERVIEW</p>
                  <h2 id="admin-overview">今天广场还好吗</h2>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadStats()}>
                  刷新
                </button>
              </header>

              {statsLoading || !stats ? (
                <div className="admin-stats">
                  {[0, 1, 2, 3].map((i) => (
                    <div className="stat-card" key={i}>
                      <div className="skeleton skeleton-line w40" />
                      <div className="skeleton skeleton-title" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="admin-stats">
                    {[
                      ['用户', stats.stats.users, `今日 +${stats.stats.todayUsers}`],
                      ['问题', stats.stats.questions, `今日 +${stats.stats.todayQuestions}`],
                      ['投票', stats.stats.votes, `今日 +${stats.stats.todayVotes}`],
                      ['理由', stats.stats.reasons, '有内容的票'],
                    ].map(([label, value, hint]) => (
                      <div className="stat-card" key={label as string}>
                        <span>{label}</span>
                        <strong>{Number(value).toLocaleString('zh-CN')}</strong>
                        <em>{hint}</em>
                      </div>
                    ))}
                  </div>

                  <div className="admin-grid">
                    <div className="admin-col">
                      <section className="aside-card">
                        <h2>分类分布</h2>
                        <ul className="cat-bars">
                          {stats.categories.map((c) => (
                            <li key={c.category}>
                              <span>{c.category}</span>
                              <div>
                                <i style={{ width: `${Math.max(6, (c.count / maxCategory) * 100)}%` }} />
                              </div>
                              <em>{c.count}</em>
                            </li>
                          ))}
                        </ul>
                      </section>

                      <section className="aside-card admin-quick">
                        <h2>快捷操作</h2>
                        <button type="button" className="admin-quick-btn" onClick={() => switchTab('questions')}>
                          <span>管理内容</span>
                          <em>精选、截止、删除 →</em>
                        </button>
                        <button type="button" className="admin-quick-btn" onClick={() => switchTab('users')}>
                          <span>管理用户</span>
                          <em>停用、恢复账号 →</em>
                        </button>
                        <button type="button" className="admin-quick-btn" onClick={() => switchTab('reports')}>
                          <span>处理举报</span>
                          <em>待处理 {stats.stats.pendingReports} 条 →</em>
                        </button>
                        <button type="button" className="admin-quick-btn" onClick={() => switchTab('audit')}>
                          <span>审计日志</span>
                          <em>谁在什么时候做了什么 →</em>
                        </button>
                      </section>
                    </div>

                    <section className="aside-card">
                      <h2>最新问题</h2>
                      <ul className="recent-list">
                        {stats.recent.map((q) => (
                          <li key={q.id}>
                            <Link to={`/q/${q.id}`}>{q.title}</Link>
                            <span>
                              {q.author} · {timeAgo(q.createdAt)}
                              {q.featured ? ' · 精选' : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  <p className="admin-note">
                    当前共 {stats.stats.open} 个进行中、{stats.stats.closed} 个已截止问题；
                    {stats.stats.banned} 个用户被停用，{stats.stats.deletedUsers} 个账号已注销。
                    <strong> {stats.stats.pendingReports} 条举报待处理</strong>，审核队列将在 Day 7 上线。
                  </p>
                </>
              )}
            </section>
          ) : null}

          {tab === 'questions' ? (
            <section aria-labelledby="admin-questions">
              <header className="admin-head">
                <div>
                  <p className="eyebrow">CONTENT</p>
                  <h2 id="admin-questions">内容管理</h2>
                </div>
                <span className="muted">共 {questionTotal} 个问题</span>
              </header>

              <div className="admin-toolbar">
                <form
                  className="feed-search"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setQuestionPage(1)
                    void loadQuestions()
                  }}
                >
                  <input
                    value={questionQ}
                    onChange={(e) => setQuestionQ(e.target.value)}
                    placeholder="搜索标题或作者"
                    aria-label="搜索问题"
                  />
                  <button type="submit" className="text-btn">
                    搜索
                  </button>
                </form>
                <select
                  value={questionStatus}
                  onChange={(e) => {
                    setQuestionStatus(e.target.value)
                    setQuestionPage(1)
                  }}
                  aria-label="状态筛选"
                >
                  <option value="all">全部状态</option>
                  <option value="open">进行中</option>
                  <option value="closed">已截止</option>
                </select>
              </div>

              {questionsLoading ? (
                <p className="muted">加载中…</p>
              ) : questionError ? (
                <div className="alert" role="alert">
                  {questionError}
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>问题</th>
                          <th>作者</th>
                          <th>票数</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.map((q) => (
                          <tr key={q.id}>
                            <td>
                              <Link to={`/q/${q.id}`} className="table-title">
                                {q.title}
                              </Link>
                              <div className="table-sub">
                                {q.category} · {timeAgo(q.createdAt)}
                                {q.featured ? ' · 精选' : ''}
                                {q.anonymous ? ' · 匿名' : ''}
                              </div>
                            </td>
                            <td>{q.author?.username ?? '匿名'}</td>
                            <td>
                              {q.counts.total} <span className="muted">/ {q.counts.reasons} 理由</span>
                            </td>
                            <td>
                              <span className={`tag${q.status === 'closed' ? '' : ' tag-ok'}`}>
                                {q.status === 'closed' ? '已截止' : '进行中'}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="btn btn-xs btn-ghost"
                                  disabled={busyId === q.id}
                                  onClick={() => void toggleFeatured(q)}
                                >
                                  {q.featured ? '取消精选' : '设为精选'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-ghost"
                                  disabled={busyId === q.id}
                                  onClick={() => void toggleClosed(q)}
                                >
                                  {q.status === 'open' ? '截止' : '重开'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-danger"
                                  disabled={busyId === q.id}
                                  onClick={() => void removeQuestion(q)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!questions.length ? (
                          <tr>
                            <td colSpan={5} className="table-empty">
                              没有匹配的问题
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-pager">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={questionPage <= 1}
                      onClick={() => setQuestionPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <span>
                      第 {questionPage} / {Math.max(1, Math.ceil(questionTotal / 20))} 页
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={questionPage >= Math.ceil(questionTotal / 20)}
                      onClick={() => setQuestionPage((p) => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === 'users' ? (
            <section aria-labelledby="admin-users">
              <header className="admin-head">
                <div>
                  <p className="eyebrow">PEOPLE</p>
                  <h2 id="admin-users">用户管理</h2>
                </div>
                <span className="muted">共 {users.length} 个账号</span>
              </header>

              <div className="admin-toolbar">
                <form
                  className="feed-search"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void loadUsers()
                  }}
                >
                  <input
                    value={userQ}
                    onChange={(e) => setUserQ(e.target.value)}
                    placeholder="搜索昵称或邮箱"
                    aria-label="搜索用户"
                  />
                  <button type="submit" className="text-btn">
                    搜索
                  </button>
                </form>
              </div>

              {usersLoading ? (
                <p className="muted">加载中…</p>
              ) : userError ? (
                <div className="alert" role="alert">
                  {userError}
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>用户</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>发起 / 投票</th>
                        <th>注册时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className="user-cell">
                              <Avatar name={u.username} hue={u.avatarHue} size={30} />
                              <div>
                                <strong>{u.username}</strong>
                                <span>
                                  {u.email}
                                  {!u.emailVerified ? (
                                    <span className="tag user-unverified">未验证</span>
                                  ) : null}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`tag${u.role === 'admin' ? ' tag-accent' : ''}`}>
                              {u.role === 'admin' ? '管理员' : '用户'}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`tag${u.status === 'active' ? ' tag-ok' : ''}`}
                            >
                              {u.status === 'banned'
                                ? '已停用'
                                : u.status === 'deleted'
                                  ? '已注销'
                                  : '正常'}
                            </span>
                          </td>
                          <td>
                            {u.questions} / {u.votes}
                          </td>
                          <td className="muted">{fullDate(u.createdAt)}</td>
                          <td>
                            {u.status === 'deleted' ? (
                              <span className="muted">不可操作</span>
                            ) : (
                              <button
                                type="button"
                                className={`btn btn-xs ${u.status === 'banned' ? 'btn-ghost' : 'btn-danger'}`}
                                disabled={u.role === 'admin' || busyId === u.id}
                                onClick={() => void toggleUser(u)}
                              >
                                {u.status === 'banned' ? '恢复' : '停用'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {tab === 'reports' ? (
            <section aria-labelledby="admin-reports">
              <header className="admin-head">
                <div>
                  <p className="eyebrow">MODERATION</p>
                  <h2 id="admin-reports">举报队列</h2>
                </div>
                <span className="muted">共 {reportTotal} 条</span>
              </header>

              <div className="segment report-tabs" role="tablist" aria-label="举报状态">
                {REPORT_STATUS_TABS.map((item) => {
                  const count =
                    item.value === 'all'
                      ? reportCounts.pending + reportCounts.resolved + reportCounts.rejected
                      : reportCounts[item.value as 'pending' | 'resolved' | 'rejected']
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="tab"
                      aria-selected={reportStatus === item.value}
                      className={`segment-item${reportStatus === item.value ? ' on' : ''}`}
                      onClick={() => {
                        setReportStatus(item.value)
                        setReportPage(1)
                      }}
                    >
                      {item.label} {count}
                    </button>
                  )
                })}
              </div>

              <div className="admin-toolbar">
                <form
                  className="feed-search"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setReportPage(1)
                    setReportQuery(reportQ.trim())
                    setReportNonce((n) => n + 1)
                  }}
                >
                  <input
                    value={reportQ}
                    onChange={(e) => setReportQ(e.target.value)}
                    placeholder="搜索问题、举报人或说明"
                    aria-label="搜索举报"
                  />
                  <button type="submit" className="text-btn">
                    搜索
                  </button>
                </form>
                <select
                  value={reportSort}
                  onChange={(e) => {
                    setReportSort(e.target.value)
                    setReportPage(1)
                  }}
                  aria-label="举报排序"
                >
                  <option value="new">最新举报</option>
                  <option value="old">最早举报</option>
                  <option value="most">同题举报最多</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setReportNonce((n) => n + 1)}
                >
                  刷新
                </button>
              </div>

              {reportsLoading ? (
                <p className="muted">正在加载举报…</p>
              ) : reportError ? (
                <div className="alert" role="alert">
                  {reportError}
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="admin-table report-table">
                      <thead>
                        <tr>
                          <th>举报内容</th>
                          <th>被举报问题</th>
                          <th>举报人</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportItems.map((report) => (
                          <tr key={report.id}>
                            <td>
                              <span className="tag report-reason-tag">
                                {reportReasonLabel(report.reason)}
                              </span>
                              <div className="table-sub report-detail-cell">
                                {report.detail || '未填写补充说明'}
                              </div>
                            </td>
                            <td>
                              {report.question ? (
                                <Link
                                  to={`/q/${report.question.id}`}
                                  className="table-title"
                                >
                                  {report.question.title}
                                </Link>
                              ) : (
                                <strong className="table-title">
                                  {report.questionTitle || '问题已删除'}
                                </strong>
                              )}
                              <div className="table-sub">
                                {report.question?.author
                                  ? `@${report.question.author.username}`
                                  : '作者不可用'}
                                {report.question
                                  ? ` · 同题 ${report.question.reportCount} 条举报`
                                  : ' · 问题已删除'}
                              </div>
                            </td>
                            <td>@{report.reporter.username}</td>
                            <td>
                              <span className={`tag report-${report.status}`}>
                                {reportStatusLabel(report.status)}
                              </span>
                              <div className="table-sub">
                                {report.handledAt
                                  ? `${
                                      report.handledBy
                                        ? `@${report.handledBy.username}`
                                        : '管理员'
                                    } · ${timeAgo(report.handledAt)}`
                                  : timeAgo(report.createdAt)}
                              </div>
                            </td>
                            <td>
                              {report.status === 'pending' ? (
                                <div className="row-actions report-actions">
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-ghost"
                                    disabled={busyId === report.id}
                                    onClick={() => void handleReport(report, 'resolve')}
                                  >
                                    标记已处理
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-ghost"
                                    disabled={busyId === report.id}
                                    onClick={() => void handleReport(report, 'reject')}
                                  >
                                    驳回
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-danger"
                                    disabled={busyId === report.id}
                                    onClick={() => void handleReport(report, 'ban_author')}
                                  >
                                    停用作者
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-danger"
                                    disabled={busyId === report.id}
                                    onClick={() => void handleReport(report, 'delete_question')}
                                  >
                                    删除问题
                                  </button>
                                </div>
                              ) : (
                                <span className="muted">已处理</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!reportItems.length ? (
                          <tr>
                            <td colSpan={5} className="table-empty">
                              当前没有匹配的举报
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-pager">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={reportPage <= 1}
                      onClick={() => setReportPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <span>
                      第 {reportPage} / {Math.max(1, Math.ceil(reportTotal / 20))} 页
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={reportPage >= Math.ceil(reportTotal / 20)}
                      onClick={() => setReportPage((p) => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === 'audit' ? (
            <section aria-labelledby="admin-audit">
              <header className="admin-head">
                <div>
                  <p className="eyebrow">AUDIT</p>
                  <h2 id="admin-audit">审计日志</h2>
                </div>
                <span className="muted">只读 · 共 {auditTotal} 条</span>
              </header>

              <div className="admin-toolbar">
                <form
                  className="feed-search"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setAuditPage(1)
                    setAuditQuery(auditQ.trim())
                    setAuditNonce((n) => n + 1)
                  }}
                >
                  <input
                    value={auditQ}
                    onChange={(e) => setAuditQ(e.target.value)}
                    placeholder="搜索动作、操作者、对象或标题"
                    aria-label="搜索审计日志"
                  />
                  <button type="submit" className="text-btn">
                    搜索
                  </button>
                </form>
                <select
                  value={auditCategory}
                  onChange={(e) => {
                    setAuditCategory(e.target.value)
                    setAuditPage(1)
                  }}
                  aria-label="审计类型"
                >
                  {AUDIT_CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAuditNonce((n) => n + 1)}
                >
                  刷新
                </button>
              </div>

              <p className="admin-note audit-readonly">
                审计日志由服务端自动写入，管理台只读；没有修改或删除接口。
              </p>

              {auditsLoading ? (
                <p className="muted">加载中…</p>
              ) : auditError ? (
                <div className="alert" role="alert">
                  {auditError}
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="admin-table audit-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>动作</th>
                          <th>操作者</th>
                          <th>对象</th>
                          <th>来源 IP</th>
                          <th>详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audits.map((log) => (
                          <tr key={log.id}>
                            <td className="audit-time">
                              {fullDate(log.createdAt)}
                              <div className="table-sub">{timeAgo(log.createdAt)}</div>
                            </td>
                            <td>
                              <span className="tag audit-tag">{actionLabel(log.action)}</span>
                              <div className="table-sub audit-code">{log.action}</div>
                            </td>
                            <td>
                              {log.actor ? (
                                `@${log.actor.username}`
                              ) : (
                                <span className="muted">系统 / 匿名</span>
                              )}
                            </td>
                            <td>
                              <span className="audit-target">{targetLabel(log)}</span>
                              <div className="table-sub">{log.targetType ?? '—'}</div>
                            </td>
                            <td className="audit-ip">{log.ip || '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => setAuditDetail(log)}
                              >
                                查看
                              </button>
                            </td>
                          </tr>
                        ))}
                        {!audits.length ? (
                          <tr>
                            <td colSpan={6} className="table-empty">
                              没有匹配的审计记录
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-pager">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={auditPage <= 1}
                      onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <span>
                      第 {auditPage} / {Math.max(1, Math.ceil(auditTotal / 20))} 页
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={auditPage >= Math.ceil(auditTotal / 20)}
                      onClick={() => setAuditPage((p) => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </main>
      </div>

      <Modal
        open={auditDetail !== null}
        onClose={() => setAuditDetail(null)}
        title="审计详情"
        subtitle={auditDetail ? actionLabel(auditDetail.action) : undefined}
      >
        {auditDetail ? (
          <dl className="audit-detail">
            <div>
              <dt>动作</dt>
              <dd>
                {actionLabel(auditDetail.action)}
                <span className="audit-code">{auditDetail.action}</span>
              </dd>
            </div>
            <div>
              <dt>操作者</dt>
              <dd>{auditDetail.actor ? `@${auditDetail.actor.username}` : '系统 / 匿名'}</dd>
            </div>
            <div>
              <dt>对象</dt>
              <dd>
                {targetLabel(auditDetail)}
                <span className="audit-code">{auditDetail.targetType ?? '—'}</span>
              </dd>
            </div>
            <div>
              <dt>来源 IP</dt>
              <dd>{auditDetail.ip || '—'}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{fullDate(auditDetail.createdAt)}</dd>
            </div>
            <div className="audit-detail-wide">
              <dt>附加信息</dt>
              <dd>
                <pre>{JSON.stringify(auditDetail.meta, null, 2)}</pre>
              </dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </Layout>
  )
}
