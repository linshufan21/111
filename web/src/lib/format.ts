export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(then).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function deadline(iso: string | null): { label: string; urgent: boolean } | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(diff)) return null
  if (diff <= 0) return { label: '已截止', urgent: false }
  const hour = 3_600_000
  if (diff < hour) return { label: `${Math.max(1, Math.floor(diff / 60_000))} 分钟后截止`, urgent: true }
  if (diff < 24 * hour) return { label: `${Math.floor(diff / hour)} 小时后截止`, urgent: true }
  return { label: `${Math.ceil(diff / (24 * hour))} 天后截止`, urgent: false }
}

export function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

export function compact(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function fullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
