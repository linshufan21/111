import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'
import { useToast } from './Toast'

interface Props {
  variant?: 'primary' | 'ghost' | 'soft'
  size?: 'sm' | 'md'
  block?: boolean
}

export function ResendVerificationButton({
  variant = 'primary',
  size = 'md',
  block = false,
}: Props) {
  const { user } = useAuth()
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  if (!user || user.emailVerified) return null

  async function resend() {
    if (busy || cooldown > 0) return
    setBusy(true)
    try {
      await api.resendVerification()
      setCooldown(60)
      notify('验证邮件已发送，请查收邮箱', 'success')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '发送失败，请稍后再试', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      block={block}
      loading={busy}
      disabled={cooldown > 0}
      onClick={() => void resend()}
    >
      {cooldown > 0 ? `${cooldown} 秒后可重发` : '重新发送验证邮件'}
    </Button>
  )
}
