import type { ReportReason, ReportStatus } from '../api/types'

export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'spam', label: '垃圾广告', hint: '推广、引流、重复刷屏' },
  { value: 'abuse', label: '辱骂攻击', hint: '人身攻击、歧视、骚扰' },
  { value: 'privacy', label: '泄露隐私', hint: '真实姓名、联系方式、住址' },
  { value: 'misleading', label: '误导虚假', hint: '编造事实、诱导性内容' },
  { value: 'other', label: '其他', hint: '请补充说明具体问题' },
]

const REASON_LABELS = Object.fromEntries(
  REPORT_REASONS.map((item) => [item.value, item.label]),
) as Record<ReportReason, string>

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: '待处理',
  resolved: '已处理',
  rejected: '已驳回',
}

export function reportReasonLabel(reason: string) {
  return REASON_LABELS[reason as ReportReason] ?? reason
}

export function reportStatusLabel(status: string) {
  return STATUS_LABELS[status as ReportStatus] ?? status
}
