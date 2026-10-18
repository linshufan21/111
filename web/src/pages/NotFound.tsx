import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'

export function NotFound() {
  return (
    <Layout>
      <div className="state-card not-found">
        <p className="eyebrow">404</p>
        <h1>这个页面不在选票上</h1>
        <p>链接可能写错了，或者这个问题已经被收进档案。</p>
        <Link to="/" className="btn btn-primary">
          回到广场
        </Link>
      </div>
    </Layout>
  )
}
