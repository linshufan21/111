export type Choice = 'yes' | 'no'
export type SortKey = 'new' | 'hot' | 'controversial' | 'closing'
export type Category = '消费' | '生活' | '工作' | '关系' | '其他'

export interface User {
  id: string
  username: string
  email: string
  avatarHue: number
  role: 'user' | 'admin'
  status: 'active' | 'banned' | 'deleted'
  emailVerified: boolean
  emailVerifiedAt: string | null
  createdAt: string | null
}

export interface AppMeta {
  requireEmailVerification: boolean
  devMail: boolean
}

export interface DevMailItem {
  id: string
  kind: 'email_verify' | 'password_reset'
  from: string
  to: string
  subject: string
  text: string
  link: string
  createdAt: string
  expiresAt: string
}

export interface Author {
  username: string
  avatarHue: number
  deleted?: boolean
}

export interface SessionInfo {
  id: string
  current: boolean
  device: string
  ip: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

export interface Counts {
  yes: number
  no: number
  total: number
  reasons: number
}

export interface MyVote {
  choice: Choice
  reason: string
  anonymous?: boolean
}

export interface Question {
  id: string
  title: string
  description: string
  category: Category | string
  createdAt: string
  closesAt: string | null
  status: 'open' | 'closed'
  anonymous: boolean
  featured: boolean
  author: Author | null
  counts: Counts
  myVote: MyVote | null
  isMine: boolean
}

export interface Reason {
  choice: Choice
  reason: string
  updatedAt: string
  mine?: boolean
  author: Author | null
}

export interface QuestionList {
  items: Question[]
  nextCursor: string | null
}

export type ReportReason = 'spam' | 'abuse' | 'privacy' | 'misleading' | 'other'
export type ReportStatus = 'pending' | 'resolved' | 'rejected'

export interface Report {
  id: string
  reason: ReportReason
  detail: string
  status: ReportStatus
  createdAt: string
  handledAt: string | null
  question?: {
    id: string
    title: string
    status: 'open' | 'closed'
  }
}

export interface QuestionDetail {
  question: Question
  reasons: Reason[]
  myReport: Report | null
}

export interface AdminStats {
  stats: {
    users: number
    questions: number
    votes: number
    reasons: number
    open: number
    closed: number
    banned: number
    deletedUsers: number
    todayUsers: number
    todayQuestions: number
    todayVotes: number
    pendingReports: number
  }
  categories: { category: string; count: number }[]
  recent: {
    id: string
    title: string
    createdAt: string
    status: 'open' | 'closed'
    featured: boolean
    author: string
  }[]
}

export interface AdminQuestion {
  id: string
  title: string
  category: string
  status: 'open' | 'closed'
  featured: boolean
  anonymous: boolean
  author: Author | null
  createdAt: string
  closesAt: string | null
  counts: Counts
}

export interface AdminUser {
  id: string
  username: string
  email: string
  role: 'user' | 'admin'
  status: 'active' | 'banned' | 'deleted'
  emailVerified: boolean
  avatarHue: number
  createdAt: string
  questions: number
  votes: number
}

export interface AdminReport {
  id: string
  reason: ReportReason
  detail: string
  status: ReportStatus
  createdAt: string
  handledAt: string | null
  question: {
    id: string
    title: string
    status: 'open' | 'closed'
    author: { id: string; username: string } | null
    reportCount: number
  } | null
  questionTitle: string
  reporter: { id: string; username: string }
  handledBy: { username: string } | null
}

export interface UserNotification {
  id: string
  type: string
  payload: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

export interface AuditActor {
  id: string
  username: string
}

export interface AuditLog {
  id: string
  action: string
  actor: AuditActor | null
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown>
  ip: string
  createdAt: string
}

export interface AuditList {
  items: AuditLog[]
  total: number
  page: number
  limit: number
}
