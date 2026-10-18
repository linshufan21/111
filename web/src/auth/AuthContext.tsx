import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import type { AppMeta, User } from '../api/types'

type Status = 'loading' | 'anon' | 'authed'

interface AuthValue {
  user: User | null
  meta: AppMeta | null
  status: Status
  login: (identifier: string, password: string) => Promise<User>
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ user: User; verificationSent: boolean }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [meta, setMeta] = useState<AppMeta | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const refresh = useCallback(async () => {
    try {
      const [{ user: me }, appMeta] = await Promise.all([
        api.me(),
        api.meta().catch(() => null),
      ])
      setUser(me)
      setStatus(me ? 'authed' : 'anon')
      if (appMeta) setMeta(appMeta)
    } catch {
      setUser(null)
      setStatus('anon')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const expired = () => {
      setUser(null)
      setStatus('anon')
    }
    window.addEventListener('auth:expired', expired)
    return () => window.removeEventListener('auth:expired', expired)
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    const { user: me } = await api.login(identifier, password)
    setUser(me)
    setStatus('authed')
    return me
  }, [])

  const register = useCallback(async (username: string, email: string, password: string) => {
    const { user: me, verificationSent } = await api.register(username, email, password)
    setUser(me)
    setStatus('authed')
    return { user: me, verificationSent: Boolean(verificationSent) }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setStatus('anon')
    }
  }, [])

  const value = useMemo(
    () => ({ user, meta, status, login, register, logout, refresh }),
    [user, meta, status, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
