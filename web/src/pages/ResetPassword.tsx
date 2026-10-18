import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Layout } from '../components/Layout'

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (password.length < 8) next.password = '新密码至少 8 位'
    if (password.length > 72) next.password = '新密码最多 72 位'
    if (confirm !== password) next.confirm = '两次输入的密码不一致'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setServerError('')
    if (!validate() || busy) return
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      await logout()
      navigate('/login?reset=1', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_RESET_TOKEN') {
          setExpired(true)
        } else if (err.field) {
          setErrors({ [err.field]: err.message })
        } else {
          setServerError(err.message)
        }
      } else {
        setServerError('重置失败，请稍后再试')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout>
      <div className="recovery-shell">
        <section className="recovery-card" aria-labelledby="reset-title">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1 id="reset-title">设置新密码</h1>

          {!token || expired ? (
            <div className="recovery-success recovery-warn" role="alert">
              <h2>重置链接无效或已过期</h2>
              <p>重置链接 30 分钟内有效，且只能使用一次。请重新申请一封。</p>
              <div className="recovery-actions">
                <Link to="/forgot-password" className="btn btn-primary">
                  重新申请
                </Link>
                <Link to="/login" className="btn btn-ghost">
                  返回登录
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="recovery-lede">
                输入一个新密码。重置成功后，所有设备都会退出登录，需要用新密码重新登录。
              </p>
              <form className="recovery-form" onSubmit={submit} noValidate>
                {serverError ? (
                  <div className="alert" role="alert">
                    {serverError}
                  </div>
                ) : null}
                <Field
                  label="新密码"
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={errors.password}
                  hint="至少 8 位，建议混合字母、数字与符号"
                  placeholder="新的密码"
                  autoFocus
                />
                <Field
                  label="确认新密码"
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  error={errors.confirm}
                  placeholder="再输入一次"
                />
                <Button type="submit" block loading={busy}>
                  重置密码
                </Button>
              </form>
            </>
          )}

          <p className="recovery-foot">
            <Link to="/login">← 返回登录</Link>
            {!expired && token ? <Link to="/forgot-password">重新申请</Link> : null}
          </p>
        </section>
      </div>
    </Layout>
  )
}
