import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePostingGate } from '../auth/usePostingGate'
import { Header } from './Header'
import { VerifyBanner } from './VerifyBanner'

export function Layout({ children }: { children: ReactNode }) {
  const needVerify = usePostingGate()

  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <Header />
      <VerifyBanner />
      <main id="main" className="page">
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <strong>大家来决定</strong>
            <p>把纠结交给大家，把理由留给明天。</p>
          </div>
          <nav aria-label="页脚">
            <Link to="/">广场</Link>
            <Link to={needVerify ? '/settings#email' : '/?compose=1'}>发起投票</Link>
            <Link to="/login">登录</Link>
            <Link to="/privacy">隐私政策</Link>
            <Link to="/terms">用户协议</Link>
          </nav>
          <p className="footer-copy">© {new Date().getFullYear()} 大家来决定 · 一个温和的公共投票实验</p>
        </div>
      </footer>
    </>
  )
}
