import { Link } from 'react-router-dom'

interface Props {
  compact?: boolean
  dark?: boolean
}

export function Logo({ compact = false, dark = false }: Props) {
  return (
    <Link to="/" className={`logo${dark ? ' logo-dark' : ''}`} aria-label="大家来决定 首页">
      <span className="logo-mark" aria-hidden="true">
        决
      </span>
      {compact ? null : (
        <span className="logo-text">
          大家来决定
          <em>LET THE CROWD DECIDE</em>
        </span>
      )}
    </Link>
  )
}
