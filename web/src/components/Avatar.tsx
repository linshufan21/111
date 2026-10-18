interface Props {
  name: string
  hue?: number
  size?: number
  className?: string
}

export function Avatar({ name, hue = 18, size = 34, className = '' }: Props) {
  const label = Array.from(name || '?')[0] ?? '?'
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.4)),
        background: `hsl(${hue} 42% 88%)`,
        color: `hsl(${hue} 42% 26%)`,
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  )
}
