import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Logo } from '../components/Logo'

type Tab = 'login' | 'register'

function safeNext(value: string | null): string {
  if (!value) return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export function Login() {
  const { user, status, login, register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const resetSuccess = params.get('reset') === '1'

  const [tab, setTab] = useState<Tab>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const justRegistered = useRef(false)
  const registerTarget = useRef('/verify-email?status=sent')

  if (status === 'authed' && user) {
    const target = justRegistered.current && !user.emailVerified ? registerTarget.current : next
    return <Navigate to={target} replace />
  }

  function switchTab(nextTab: Tab) {
    setTab(nextTab)
    setErrors({})
    setServerError('')
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (tab === 'login') {
      if (!identifier.trim()) next.identifier = '请输入用户名或邮箱'
      if (!password) next.password = '请输入密码'
    } else {
      if (username.trim().length < 2) next.username = '昵称至少 2 个字'
      if (username.trim().length > 20) next.username = '昵称最多 20 个字'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = '邮箱格式不正确'
      if (password.length < 8) next.password = '密码至少 8 位'
      if (confirm !== password) next.confirm = '两次输入的密码不一致'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setServerError('')
    if (!validate() || busy) return
    setBusy(true)
    try {
      if (tab === 'register') justRegistered.current = true
      let me
      if (tab === 'login') {
        me = await login(identifier.trim(), password)
      } else {
        const result = await register(username.trim(), email.trim(), password)
        me = result.user
        registerTarget.current = `/verify-email?status=${result.verificationSent ? 'sent' : 'send-failed'}`
      }
      if (tab === 'register' && !me.emailVerified) {
        navigate(registerTarget.current, { replace: true })
        return
      }
      justRegistered.current = false
      navigate(next, { replace: true })
    } catch (err) {
      justRegistered.current = false
      if (err instanceof ApiError) {
        if (err.field) {
          setErrors({ [err.field]: err.message })
        } else {
          setServerError(err.message)
        }
      } else {
        setServerError('网络有点问题，请稍后再试')
      }
    } finally {
      setBusy(false)
    }
  }

  async function loginDemo() {
    setDemoBusy(true)
    setServerError('')
    try {
      await login('demo', 'demo1234')
      navigate(next, { replace: true })
    } catch {
      setServerError('体验账号暂时不可用，请稍后再试')
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-brand" aria-label="大家来决定 介绍">
        <div className="brand-top">
          <Logo dark />
          <span className="brand-edition">公共投票 · 第 001 期</span>
        </div>

        <div className="brand-copy">
          <p className="eyebrow">COLLECTIVE DECISION MAKING</p>
          <h1>
            别再纠结，
            <br />
            让大家来决定。
          </h1>
          <p className="brand-lede">
            把生活里的「要不要」写成一道选择题。陌生人投下是或否，并留下理由——
            你得到的不是标准答案，而是一群人的真实经验。
          </p>
        </div>

        <div className="ballot-stack" aria-hidden="true">
          <article className="ballot-ticket ballot-1">
            <span className="ballot-no">BALLOT · 024</span>
            <h3>周末要不要去爬山？</h3>
            <div className="ballot-bar">
              <span style={{ width: '64%' }} />
            </div>
            <div className="ballot-meta">
              <span>是 64%</span>
              <span>1,284 票</span>
            </div>
          </article>
          <article className="ballot-ticket ballot-2">
            <span className="ballot-no">BALLOT · 031</span>
            <h3>要不要买 iPhone 18？</h3>
            <div className="ballot-bar ballot-bar-no">
              <span style={{ width: '57%' }} />
            </div>
            <div className="ballot-meta">
              <span>否 57%</span>
              <span>892 票</span>
            </div>
          </article>
          <article className="ballot-ticket ballot-3">
            <span className="ballot-no">BALLOT · 038</span>
            <h3>要不要搬到对方的城市？</h3>
            <div className="ballot-bar">
              <span style={{ width: '51%' }} />
            </div>
            <div className="ballot-meta">
              <span>是 51%</span>
              <span>2,046 票</span>
            </div>
          </article>
        </div>

        <dl className="brand-stats">
          <div>
            <dt>12,480</dt>
            <dd>个决定</dd>
          </div>
          <div>
            <dt>38,902</dt>
            <dd>张票</dd>
          </div>
          <div>
            <dt>8,214</dt>
            <dd>条理由</dd>
          </div>
        </dl>
      </section>

      <section className="auth-form-panel">
        <div className="auth-topline">
          <Link to="/" className="back-link">
            ← 先随便逛逛
          </Link>
          <span className="muted">登录后即可投票与发起</span>
        </div>

        <div className="auth-card">
          <div className="auth-heading">
            <p className="eyebrow">{tab === 'login' ? 'WELCOME BACK' : 'JOIN THE CROWD'}</p>
            <h2>{tab === 'login' ? '回来继续做决定' : '创建你的账号'}</h2>
            <p>{tab === 'login' ? '用账号或邮箱登录，看看今天大家在纠结什么。' : '一分钟注册，就能发问题、投票、写理由。'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="登录或注册">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={tab === 'login' ? 'on' : ''}
              onClick={() => switchTab('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              className={tab === 'register' ? 'on' : ''}
              onClick={() => switchTab('register')}
            >
              注册
            </button>
          </div>

          {serverError ? (
            <div className="alert" role="alert">
              {serverError}
            </div>
          ) : null}

          {resetSuccess ? (
            <div className="alert alert-ok" role="status">
              密码已重置，请用新密码登录。
            </div>
          ) : null}

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            {tab === 'login' ? (
              <Field
                label="用户名或邮箱"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                error={errors.identifier}
                placeholder="demo"
              />
            ) : (
              <>
                <Field
                  label="昵称"
                  autoComplete="nickname"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  error={errors.username}
                  placeholder="别人会看到的名字"
                />
                <Field
                  label="邮箱"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={errors.email}
                  placeholder="you@example.com"
                />
              </>
            )}

            <div className="password-wrap">
              <Field
                label="密码"
                type={showPassword ? 'text' : 'password'}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                placeholder={tab === 'login' ? '输入密码' : '至少 8 位'}
                className="has-suffix"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>

            {tab === 'login' ? (
              <div className="login-forgot">
                <Link to="/forgot-password">忘记密码？</Link>
              </div>
            ) : null}

            {tab === 'register' ? (
              <Field
                label="确认密码"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={errors.confirm}
                placeholder="再输入一次"
              />
            ) : null}

            <Button type="submit" block loading={busy} className="auth-submit">
              {tab === 'login' ? '进入广场' : '创建账号'}
            </Button>
          </form>

          <div className="auth-divider">
            <span>或者</span>
          </div>

          <Button
            type="button"
            variant="ghost"
            block
            loading={demoBusy}
            onClick={loginDemo}
            className="demo-btn"
          >
            用体验账号进入（demo / demo1234）
          </Button>

          <p className="auth-legal">
            登录即表示你同意做一个友善的投票者：不攻击、不泄露隐私、认真写理由。
            <br />
            继续即表示你已阅读 <Link to="/terms">用户协议</Link> 与 <Link to="/privacy">隐私政策</Link>。
          </p>
        </div>

        <p className="auth-side-note">
          {tab === 'login' ? '第一次来？' : '已经有账号？'}{' '}
          <button type="button" className="text-btn" onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}>
            {tab === 'login' ? '创建一个账号' : '直接登录'}
          </button>
        </p>
      </section>
    </div>
  )
}
