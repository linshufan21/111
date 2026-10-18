import type { UserNotification } from '../api/types'

export function notificationText(notice: UserNotification) {
  const title = typeof notice.payload.title === 'string' ? notice.payload.title : '你的问题'
  if (notice.type === 'question.vote') return `有人给你的「${title}」投了一票。`
  if (notice.type === 'question.reason') return `你的「${title}」收到一条新理由。`
  if (notice.type === 'question.closed') return `你的「${title}」已截止。`
  if (notice.type === 'report.question_deleted') return `你举报的「${title}」已被删除。`
  if (notice.type === 'report.author_banned') return `你举报的「${title}」作者已被停用。`
  if (notice.type === 'report.rejected') return `你举报的「${title}」经核实未通过。`
  if (notice.type.startsWith('report.')) return `你举报的「${title}」已处理完成。`
  return `你有一条新通知：${title}`
}

export function notificationKindLabel(type: string) {
  if (type === 'question.vote') return '投票'
  if (type === 'question.reason') return '理由'
  if (type === 'question.closed') return '截止'
  if (type.startsWith('report.')) return '举报'
  return '通知'
}

export function notificationTone(type: string) {
  if (type === 'question.vote') return 'vote'
  if (type === 'question.reason') return 'reason'
  if (type === 'question.closed') return 'closed'
  if (type.startsWith('report.')) return 'report'
  return 'default'
}

export function notificationHref(notice: UserNotification) {
  if (notice.type.startsWith('report.')) return '/me?tab=reports'
  const questionId = notice.payload.questionId
  if (typeof questionId === 'string' && questionId) return `/q/${questionId}`
  return '/notifications'
}
