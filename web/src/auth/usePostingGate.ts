import { useAuth } from './AuthContext'

/** 当前登录用户是否被“先验证邮箱才能发帖”的规则拦住。 */
export function usePostingGate(): boolean {
  const { user, meta } = useAuth()
  return Boolean(user && meta?.requireEmailVerification && !user.emailVerified)
}
