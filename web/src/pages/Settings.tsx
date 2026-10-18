import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { SessionInfo } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Layout } from '../components/Layout'
import { Modal } from '../components/Modal'
import { ResendVerificationButton } from '../components/ResendVerificationButton'
import { useToast } from '../components/Toast'
import { fullDate, timeAgo } from '../lib/format'

const EMPTY_PASSWORD = { currentPassword: '', newPassword: '', confirm: '' }
const EMPTY_DELETE = { password: '', confirm: '' }

export function Settings() {
  const { user, meta, status, logout } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [sessionBusy, setSessionBusy] = useState('')
  const [revokingAll, setRevokingAll] = useState(false)

  const [pw, setPw] = useState(EMPTY_PASSWORD)
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({})
  const [pwServerError, setPwServerError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [del, setDel] = useState(EMPTY_DELETE)
  const [delErrors, setDelErrors] = useState<Record<string, string>>({})
  const [delBusy, setDelBusy] = useState(false)

  const loadSessions = useCallback(async (quiet = false) => {
    if (!quiet) setSessionsLoading(true)
    setSessionsError('')
    try {
      const { items } = await api.sessions()
      setSessions(items)
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : '登录设备加载失败')
    } finally {
      if (!quiet) setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) void loadSessions()
  }, [user, loadSessions])

  if (status === 'loading') {
    return (
      <Layout>
        <div className="settings-shell">
          <div className="skeleton skeleton-title lg" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return <Navigate to="/login?next=/settings" replace />
  }

  const otherSessions = sessions.filter((s) => !s.current)

  function validatePassword(): boolean {
    const next: Record<string, string> = {}
    if (!pw.currentPassword) next.currentPassword = '请输入当前密码'
    if (pw.newPassword.length < 8) next.newPassword = '新密码至少 8 位'
    if (pw.newPassword.length > 72) next.newPassword = '新密码最多 72 位'
    if (pw.newPassword && pw.newPassword === pw.currentPassword) {
      next.newPassword = '新密码不能与当前密码相同'
    }
    if (pw.confirm !== pw.newPassword) next.confirm = '两次输入的新密码不一致'
    setPwErrors(next)
    return Object.keys(next).length === 0
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPwServerError('')
    if (!validatePassword() || pwBusy) return
    setPwBusy(true)
    try {
      await api.changePassword(pw.currentPassword, pw.newPassword)
      setPw(EMPTY_PASSWORD)
      setPwErrors({})
      notify('密码已更新，其他设备已退出登录', 'success')
      await loadSessions(true)
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setPwErrors({ [err.field]: err.message })
      } else {
        setPwServerError(err instanceof ApiError ? err.message : '修改失败，请稍后再试')
      }
    } finally {
      setPwBusy(false)
    }
  }

  async function revokeOne(session: SessionInfo) {
    if (!window.confirm(`退出「${session.device}」这个登录会话？`)) return
    setSessionBusy(session.id)
    try {
      await api.revokeSession(session.id)
      setSessions((list) => list.filter((s) => s.id !== session.id))
      notify('已退出该设备', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败，请稍后再试', 'error')
    } finally {
      setSessionBusy('')
    }
  }

  async function revokeOthers() {
    if (!otherSessions.length) return
    if (
      !window.confirm(
        `将退出其他 ${otherSessions.length} 个登录会话，当前设备保持登录。继续吗？`,
      )
    ) {
      return
    }
    setRevokingAll(true)
    try {
      const { revoked } = await api.revokeOtherSessions()
      await loadSessions(true)
      notify(revoked ? `已退出 ${revoked} 个其他设备` : '没有需要退出的设备', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败，请稍后再试', 'error')
    } finally {
      setRevokingAll(false)
    }
  }

  function openDelete() {
    setDel(EMPTY_DELETE)
    setDelErrors({})
    setDeleteOpen(true)
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!del.password) next.password = '请输入当前密码'
    if (del.confirm !== '注销') next.confirm = '请输入「注销」以确认'
    setDelErrors(next)
    if (Object.keys(next).length || delBusy) return
    setDelBusy(true)
    try {
      await api.deleteAccount(del.password, del.confirm)
      setDeleteOpen(false)
      notify('账号已注销，感谢你认真投过的每一票', 'success')
      await logout()
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setDelErrors({ [err.field]: err.message })
      } else {
        notify(err instanceof ApiError ? err.message : '注销失败，请稍后再试', 'error')
      }
    } finally {
      setDelBusy(false)
    }
  }

  return (
    <Layout>
      <div className="settings-shell">
        <aside className="settings-side">
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>账号设置</h1>
          <div className="settings-profile">
            <Avatar name={user.username} hue={user.avatarHue} size={44} />
            <div>
              <strong>{user.username}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <nav className="settings-nav" aria-label="设置导航">
            <a href="#account">账号信息</a>
            <a href="#email">邮箱验证</a>
            <a href="#security">登录与安全</a>
            <a href="#danger">危险区</a>
          </nav>
          <div className="settings-side-foot">
            <Link to="/me">← 我的决定</Link>
          </div>
        </aside>

        <div className="settings-main">
          <section className="settings-section" id="account" aria-labelledby="settings-account">
            <header className="settings-section-head">
              <div>
                <p className="eyebrow">PROFILE</p>
                <h2 id="settings-account">账号信息</h2>
                <p>这些信息决定别人如何在广场里看到你。</p>
              </div>
              <span className={`tag${user.role === 'admin' ? ' tag-accent' : ''}`}>
                {user.role === 'admin' ? '管理员' : '普通用户'}
              </span>
            </header>

            <dl className="settings-grid">
              <div className="settings-item">
                <dt>昵称</dt>
                <dd>{user.username}</dd>
              </div>
              <div className="settings-item">
                <dt>邮箱</dt>
                <dd>{user.email}</dd>
              </div>
              <div className="settings-item">
                <dt>加入时间</dt>
                <dd>{user.createdAt ? fullDate(user.createdAt) : '—'}</dd>
              </div>
              <div className="settings-item">
                <dt>当前身份</dt>
                <dd>{user.role === 'admin' ? '管理员' : '投票者'}</dd>
              </div>
            </dl>

            <p className="settings-hint">
              昵称与邮箱的修改会在后续版本开放。现在如果想换一个身份，可以先注销账号后重新注册；
              历史内容会保留，但不再关联你的昵称。
            </p>
          </section>

          <section className="settings-section" id="email" aria-labelledby="settings-email">
            <header className="settings-section-head">
              <div>
                <p className="eyebrow">EMAIL</p>
                <h2 id="settings-email">邮箱验证</h2>
                <p>验证邮箱后，才能发起新的投票。</p>
              </div>
              <span className={`tag${user.emailVerified ? ' tag-ok' : ''}`}>
                {user.emailVerified ? '已验证' : '未验证'}
              </span>
            </header>

            <div className="settings-email-row">
              <div className="settings-email-copy">
                <strong>{user.email}</strong>
                <p>
                  {user.emailVerified
                    ? `已验证${user.emailVerifiedAt ? `于 ${fullDate(user.emailVerifiedAt)}` : ''}。浏览、投票和发起问题都不受影响。`
                    : '我们还没有确认这个邮箱属于你。验证前仍然可以浏览和投票，但发起问题会被拦下。'}
                </p>
                {!user.emailVerified && meta?.devMail ? (
                  <p className="settings-dev-link">
                    开发环境不会真的发信，验证链接会出现在{' '}
                    <Link to="/dev/mail">开发邮件箱</Link>。
                  </p>
                ) : null}
              </div>
              {!user.emailVerified ? (
                <ResendVerificationButton variant="ghost" size="sm" />
              ) : null}
            </div>
          </section>

          <section className="settings-section" id="security" aria-labelledby="settings-security">
            <header className="settings-section-head">
              <div>
                <p className="eyebrow">SECURITY</p>
                <h2 id="settings-security">登录与安全</h2>
                <p>定期改密，并清掉不再使用的设备。</p>
              </div>
            </header>

            <div className="settings-subhead">
              <div>
                <h3>修改密码</h3>
                <p>修改成功后，其他设备上的登录会立即失效。</p>
              </div>
            </div>

            {pwServerError ? (
              <div className="alert" role="alert">
                {pwServerError}
              </div>
            ) : null}

            <form className="settings-password-form" onSubmit={changePassword} noValidate>
              <Field
                label="当前密码"
                type="password"
                autoComplete="current-password"
                maxLength={72}
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                error={pwErrors.currentPassword}
                placeholder="确认是你本人"
              />
              <div className="settings-password-row">
                <Field
                  label="新密码"
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  value={pw.newPassword}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                  error={pwErrors.newPassword}
                  hint="至少 8 位，建议混合字母、数字与符号"
                  placeholder="新的密码"
                />
                <Field
                  label="确认新密码"
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  error={pwErrors.confirm}
                  placeholder="再输入一次"
                />
              </div>
              <div>
                <Button type="submit" loading={pwBusy}>
                  更新密码
                </Button>
              </div>
            </form>

            <div className="settings-subhead settings-devices-head">
              <div>
                <h3>登录设备</h3>
                <p>
                  当前共有 {sessions.length || 1} 个会话
                  {otherSessions.length ? `，其中 ${otherSessions.length} 个在别的设备上` : '，只有这一台设备'}。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={revokingAll}
                disabled={!otherSessions.length || sessionsLoading}
                onClick={revokeOthers}
              >
                退出其他设备
              </Button>
            </div>

            {sessionsLoading ? (
              <p className="muted">正在检查登录设备…</p>
            ) : sessionsError ? (
              <div className="alert" role="alert">
                {sessionsError}
              </div>
            ) : (
              <ul className="session-list">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className={`session-item${session.current ? ' session-current' : ''}`}
                  >
                    <span className="session-icon" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        width="17"
                        height="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      >
                        <rect x="3" y="4" width="18" height="12" rx="2" />
                        <path d="M8 20h8M12 16v4" />
                      </svg>
                    </span>
                    <div className="session-body">
                      <strong>
                        {session.device}
                        {session.current ? <span className="tag tag-ok">当前设备</span> : null}
                      </strong>
                      <span className="session-meta">
                        {session.current ? '正在使用' : `最近活动 ${timeAgo(session.lastSeenAt)}`}
                        {session.ip ? ` · IP ${session.ip}` : ''}
                      </span>
                      <span className="session-meta">
                        登录于 {fullDate(session.createdAt)} · 有效期至 {fullDate(session.expiresAt)}
                      </span>
                    </div>
                    {session.current ? (
                      <span className="session-current-note">本机</span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={sessionBusy === session.id}
                        onClick={() => void revokeOne(session)}
                      >
                        退出
                      </Button>
                    )}
                  </li>
                ))}
                {!sessions.length ? (
                  <li className="session-item">
                    <span className="session-meta">没有找到登录记录，刷新页面再试。</span>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          <section
            className="settings-section settings-danger"
            id="danger"
            aria-labelledby="settings-danger"
          >
            <header className="settings-section-head">
              <div>
                <p className="eyebrow">DANGER ZONE</p>
                <h2 id="settings-danger">危险区</h2>
                <p>注销账号不可撤销，请确认已经想清楚。</p>
              </div>
            </header>

            <div className="settings-danger-row">
              <div>
                <strong>注销账号</strong>
                <p>
                  昵称与邮箱会被清理，所有设备立即退出；你发布的问题、投票与理由会保留，
                  但作者统一显示为「已注销用户」。管理员账号不能自助注销。
                </p>
              </div>
              <Button type="button" variant="danger" onClick={openDelete}>
                注销账号
              </Button>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!delBusy) setDeleteOpen(false)
        }}
        title="确定要注销账号吗？"
        subtitle="这一步不可撤销，也不会发送确认邮件。"
        size="sm"
      >
        <form className="settings-delete-form" onSubmit={deleteAccount} noValidate>
          <div className="settings-delete-warning">
            <strong>注销后会怎样</strong>
            <ul>
              <li>昵称、邮箱与密码立即失效，无法再登录。</li>
              <li>历史问题与理由保留，作者显示为「已注销用户」。</li>
              <li>同一邮箱和昵称以后可以重新注册。</li>
            </ul>
          </div>

          <Field
            label="当前密码"
            type="password"
            autoComplete="current-password"
            maxLength={72}
            value={del.password}
            onChange={(e) => setDel({ ...del, password: e.target.value })}
            error={delErrors.password}
            placeholder="输入密码确认身份"
          />
          <Field
            label="输入「注销」确认"
            maxLength={20}
            value={del.confirm}
            onChange={(e) => setDel({ ...del, confirm: e.target.value })}
            error={delErrors.confirm}
            placeholder="注销"
          />

          <div className="settings-modal-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={delBusy}
              onClick={() => setDeleteOpen(false)}
            >
              再想想
            </Button>
            <Button type="submit" variant="danger" loading={delBusy}>
              确认注销
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  )
}
