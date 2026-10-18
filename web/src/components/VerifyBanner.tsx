import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePostingGate } from '../auth/usePostingGate'

export function VerifyBanner() {
  const { user } = useAuth()
  const needVerify = usePostingGate()
  const { pathname } = useLocation()

  if (!needVerify || !user) return null
  if (pathname.startsWith('/settings') || pathname.startsWith('/verify-email')) return null

  return (
    <div className="verify-banner" role="status">
      <div className="verify-banner-inner">
        <span>
          邮箱 <strong>{user.email}</strong> 还没有验证，验证后才能发起投票。
        </span>
        <Link to="/settings#email" className="verify-banner-link">
          去验证 →
        </Link>
      </div>
    </div>
  )
}
