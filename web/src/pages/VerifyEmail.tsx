import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Layout } from '../components/Layout'
import { ResendVerificationButton } from '../components/ResendVerificationButton'

type Status = 'sent' | 'success' | 'expired' | 'used' | 'invalid' | 'send-failed'

const VIEWS: Record<
  Status,
  { title: string; body: string; tone: 'ok' | 'info' | 'warn' }
> = {
  sent: {
    title: '验证邮件已发送',
    body: '我们已把验证链接发到你的注册邮箱。链接 24 小时内有效；没收到可以重新发送，也记得看一眼垃圾邮件。',
    tone: 'info',
  },
  success: {
    title: '邮箱验证成功',
    body: '你的邮箱已经验证，现在可以发起投票了。感谢你让这个广场更可信一点。',
    tone: 'ok',
  },
  expired: {
    title: '验证链接已过期',
    body: '验证链接 24 小时内有效。登录后可以在账号设置里重新发送一封。',
    tone: 'warn',
  },
  used: {
    title: '这个链接已经用过了',
    body: '如果邮箱已经验证成功，直接去发起投票即可；如果还没成功，请重新发送验证邮件。',
    tone: 'warn',
  },
  invalid: {
    title: '验证链接无效',
    body: '链接不完整、已经失效，或账号已不可用。登录后可以重新发送验证邮件。',
    tone: 'warn',
  },
  'send-failed': {
    title: '验证邮件没有发出去',
    body: '服务器还没有配置邮件发送。你仍然可以浏览和投票；配置好 SMTP 后，可以在账号设置重新发送。',
    tone: 'warn',
  },
}

function StatusMark({ tone }: { tone: 'ok' | 'info' | 'warn' }) {
  return (
    <span className={`verify-mark verify-mark-${tone}`} aria-hidden="true">
      {tone === 'ok' ? (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m5 12.5 4.2 4.2L19 6.5" />
        </svg>
      ) : tone === 'info' ? (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5M12 16.5v.5" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      )}
    </span>
  )
}

export function VerifyEmail() {
  const [params] = useSearchParams()
  const { user, meta, refresh } = useAuth()
  const raw = params.get('status') || 'invalid'
  const status: Status = Object.prototype.hasOwnProperty.call(VIEWS, raw)
    ? (raw as Status)
    : 'invalid'
  const view = VIEWS[status]

  useEffect(() => {
    if (status === 'success') void refresh()
  }, [status, refresh])

  const canResend = Boolean(user && !user.emailVerified)

  return (
    <Layout>
      <div className="verify-shell">
        <section className={`verify-card verify-card-${view.tone}`} aria-labelledby="verify-title">
          <p className="eyebrow">EMAIL VERIFICATION</p>
          <StatusMark tone={view.tone} />
          <h1 id="verify-title">{view.title}</h1>
          <p className="verify-body">{view.body}</p>

          <div className="verify-actions">
            {status === 'sent' ? (
              <>
                {canResend ? (
                  <ResendVerificationButton variant="primary" />
                ) : user ? null : (
                  <Link to="/login" className="btn btn-primary">
                    去登录
                  </Link>
                )}
                {user ? (
                  <Link to="/settings#email" className="btn btn-ghost">
                    账号设置
                  </Link>
                ) : null}
                <Link to="/" className="btn btn-ghost">
                  先去逛逛
                </Link>
              </>
            ) : null}

            {status === 'success' ? (
              <>
                {user ? (
                  <Link to="/?compose=1" className="btn btn-primary">
                    去发起投票
                  </Link>
                ) : (
                  <Link to="/login?next=/" className="btn btn-primary">
                    去登录
                  </Link>
                )}
                <Link to="/" className="btn btn-ghost">
                  回到广场
                </Link>
              </>
            ) : null}

            {status === 'expired' ||
            status === 'used' ||
            status === 'invalid' ||
            status === 'send-failed' ? (
              <>
                {canResend ? (
                  <ResendVerificationButton variant="primary" />
                ) : user ? null : (
                  <Link to="/login?next=/settings" className="btn btn-primary">
                    去登录
                  </Link>
                )}
                <Link to="/" className="btn btn-ghost">
                  回到广场
                </Link>
              </>
            ) : null}
          </div>

          {meta?.devMail ? (
            <p className="verify-dev-hint">
              开发环境：验证链接也会出现在{' '}
              <Link to="/dev/mail">开发邮件箱</Link>，不会真的发到外部邮箱。
            </p>
          ) : null}
        </section>
      </div>
    </Layout>
  )
}
