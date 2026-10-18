import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Layout } from '../components/Layout'

export function ForgotPassword() {
  const { meta } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [serverError, setServerError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setServerError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('邮箱格式不正确')
      return
    }
    setError('')
    setBusy(true)
    try {
      await api.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : '发送失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout>
      <div className="recovery-shell">
        <section className="recovery-card" aria-labelledby="forgot-title">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1 id="forgot-title">找回密码</h1>
          <p className="recovery-lede">
            输入注册邮箱，我们会发送一个 30 分钟内有效的重置链接。
            出于安全考虑，无论邮箱是否存在，页面都会显示相同结果。
          </p>

          {sent ? (
            <div className="recovery-success" role="status">
              <h2>如果这个邮箱已注册，重置链接已在路上</h2>
              <p>
                请检查收件箱和垃圾邮件。链接只能使用一次，30 分钟后失效。
                {meta?.devMail ? (
                  <>
                    {' '}
                    开发环境不会真的发信，可以去 <Link to="/dev/mail">开发邮件箱</Link> 查看。
                  </>
                ) : null}
              </p>
              <div className="recovery-actions">
                <Link to="/login" className="btn btn-primary">
                  返回登录
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setSent(false)
                    setEmail('')
                  }}
                >
                  换一个邮箱
                </button>
              </div>
            </div>
          ) : (
            <form className="recovery-form" onSubmit={submit} noValidate>
              {serverError ? (
                <div className="alert" role="alert">
                  {serverError}
                </div>
              ) : null}
              <Field
                label="注册邮箱"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error}
                placeholder="you@example.com"
                autoFocus
              />
              <Button type="submit" block loading={busy}>
                发送重置链接
              </Button>
            </form>
          )}

          <p className="recovery-foot">
            <Link to="/login">← 返回登录</Link>
            {meta?.devMail ? <Link to="/dev/mail">开发邮件箱</Link> : null}
          </p>
        </section>
      </div>
    </Layout>
  )
}
