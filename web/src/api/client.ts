import type {
  AdminQuestion,
  AdminReport,
  AdminStats,
  AdminUser,
  AppMeta,
  AuditList,
  Category,
  DevMailItem,
  Question,
  QuestionDetail,
  QuestionList,
  Report,
  ReportReason,
  SessionInfo,
  SortKey,
  User,
  UserNotification,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  field?: string
  retryAfter?: number

  constructor(status: number, code: string, message: string, field?: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
    this.retryAfter = retryAfter
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let csrfToken = ''
let csrfPromise: Promise<string> | null = null

function captureCsrf(data: unknown) {
  if (!data || typeof data !== 'object') return
  const value = (data as { csrfToken?: unknown }).csrfToken
  if (typeof value === 'string' && value) csrfToken = value
}

async function loadCsrf(force = false): Promise<string> {
  if (force) {
    csrfToken = ''
    csrfPromise = null
  }
  if (csrfToken) return csrfToken
  if (!csrfPromise) {
    csrfPromise = (async () => {
      const res = await fetch('/api/csrf', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const text = await res.text()
      let data: { token?: string; error?: { message?: string } } | null = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!res.ok || !data?.token) {
        throw new ApiError(
          res.status || 0,
          'CSRF_BOOTSTRAP_FAILED',
          data?.error?.message ?? '无法建立安全会话，请刷新页面后重试',
        )
      }
      csrfToken = data.token
      return csrfToken
    })().finally(() => {
      csrfPromise = null
    })
  }
  return csrfPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method ?? 'GET').toUpperCase()
  const mutating = WRITE_METHODS.has(method)
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (mutating) headers.set('X-CSRF-Token', await loadCsrf())

  const send = () => {
    if (mutating) headers.set('X-CSRF-Token', csrfToken)
    return fetch(`/api${path}`, {
      ...init,
      method,
      credentials: 'include',
      headers,
    })
  }

  let res = await send()
  let text = await res.text()
  let data = text ? JSON.parse(text) : null
  captureCsrf(data)

  if (res.status === 403 && data?.error?.code === 'BAD_CSRF' && mutating) {
    await loadCsrf(true)
    res = await send()
    text = await res.text()
    data = text ? JSON.parse(text) : null
    captureCsrf(data)
  }

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? '请求失败，请稍后再试',
      err?.field,
      typeof err?.retryAfter === 'number' ? err.retryAfter : undefined,
    )
  }
  return data as T
}

export interface ListParams {
  sort?: SortKey
  category?: string
  q?: string
  cursor?: string | null
  limit?: number
}

export const api = {
  me: () => request<{ user: User | null }>('/auth/me'),

  meta: () => request<AppMeta>('/meta'),

  resendVerification: () =>
    request<{ ok: true }>('/auth/resend-verification', { method: 'POST' }),

  forgotPassword: (email: string) =>
    request<{ ok: true }>('/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  devMail: () => request<{ items: DevMailItem[] }>('/dev/mail'),

  login: (identifier: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  register: (username: string, email: string, password: string) =>
    request<{ user: User; verificationSent?: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  listQuestions: (params: ListParams = {}) => {
    const search = new URLSearchParams()
    if (params.sort) search.set('sort', params.sort)
    if (params.category) search.set('category', params.category)
    if (params.q) search.set('q', params.q)
    if (params.cursor) search.set('cursor', params.cursor)
    if (params.limit) search.set('limit', String(params.limit))
    return request<QuestionList>(`/questions?${search.toString()}`)
  },

  getQuestion: (id: string) => request<QuestionDetail>(`/questions/${id}`),

  createQuestion: (input: {
    title: string
    description: string
    category: Category | string
    closesAt: string | null
    anonymous: boolean
  }) =>
    request<{ question: Question }>('/questions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  vote: (id: string, input: { choice: 'yes' | 'no'; reason: string; anonymous: boolean }) =>
    request<{ question: Question }>(`/questions/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  unvote: (id: string) =>
    request<{ question: Question }>(`/questions/${id}/vote`, { method: 'DELETE' }),

  myQuestions: () => request<{ items: Question[] }>('/me/questions'),

  myVotes: () => request<{ items: Question[] }>('/me/votes'),

  reportQuestion: (id: string, input: { reason: ReportReason; detail: string }) =>
    request<{ report: Report; duplicate: boolean }>(`/questions/${id}/report`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  myReports: () => request<{ items: Report[] }>('/me/reports'),

  myNotifications: () =>
    request<{ items: UserNotification[]; unread: number }>('/me/notifications'),

  markNotificationsRead: () =>
    request<{ ok: true; read: number }>('/me/notifications/read', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true; revoked: number }>('/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  sessions: () => request<{ items: SessionInfo[] }>('/me/sessions'),

  revokeSession: (id: string) =>
    request<{ ok: true }>(`/me/sessions/${id}`, { method: 'DELETE' }),

  revokeOtherSessions: () =>
    request<{ ok: true; revoked: number }>('/me/sessions/revoke-others', { method: 'POST' }),

  deleteAccount: (password: string, confirm: string) =>
    request<{ ok: true }>('/me', {
      method: 'DELETE',
      body: JSON.stringify({ password, confirm }),
    }),

  admin: {
    stats: () => request<AdminStats>('/admin/stats'),

    questions: (params: { q?: string; status?: string; page?: number } = {}) => {
      const search = new URLSearchParams()
      if (params.q) search.set('q', params.q)
      if (params.status) search.set('status', params.status)
      search.set('page', String(params.page ?? 1))
      return request<{ items: AdminQuestion[]; total: number; page: number; limit: number }>(
        `/admin/questions?${search.toString()}`,
      )
    },

    updateQuestion: (id: string, patch: { featured?: boolean; closed?: boolean }) =>
      request<{ question: Question }>(`/admin/questions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),

    deleteQuestion: (id: string) =>
      request<{ ok: true }>(`/admin/questions/${id}`, { method: 'DELETE' }),

    users: (q = '') =>
      request<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`),

    setUserStatus: (id: string, status: 'active' | 'banned') =>
      request<{ user: User }>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    reports: (
      params: { status?: string; sort?: string; q?: string; page?: number } = {},
    ) => {
      const search = new URLSearchParams()
      if (params.status) search.set('status', params.status)
      if (params.sort) search.set('sort', params.sort)
      if (params.q) search.set('q', params.q)
      search.set('page', String(params.page ?? 1))
      return request<{
        items: AdminReport[]
        total: number
        page: number
        limit: number
        counts: { pending: number; resolved: number; rejected: number }
      }>(`/admin/reports?${search.toString()}`)
    },

    handleReport: (
      id: string,
      action: 'resolve' | 'reject' | 'delete_question' | 'ban_author',
    ) =>
      request<{ ok: true; report: Report | null }>(`/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      }),

    audit: (params: { q?: string; category?: string; page?: number; limit?: number } = {}) => {
      const search = new URLSearchParams()
      if (params.q) search.set('q', params.q)
      if (params.category && params.category !== 'all') search.set('category', params.category)
      search.set('page', String(params.page ?? 1))
      search.set('limit', String(params.limit ?? 20))
      return request<AuditList>(`/admin/audit?${search.toString()}`)
    },
  },
}
