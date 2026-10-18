import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { DevMailItem } from '../api/types'
import { Layout } from '../components/Layout'
import { useToast } from '../components/Toast'
import { fullDate, timeAgo } from '../lib/format'

export function DevMail() {
  const { notify } = useToast()
  const [items, setItems] = useState<DevMailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setDisabled(false)
    try {
      const { items: rows } = await api.devMail()
      setItems(rows)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setDisabled(true)
      } else {
        setError(err instanceof ApiError ? err.message : '加载失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function copyLink(item: DevMailItem) {
    try {
      await navigator.clipboard.writeText(item.link)
      notify('验证链接已复制', 'success')
    } catch {
      notify('复制失败，请手动选中链接', 'error')
    }
  }

  return (
    <Layout>
      <div className="devmail-shell">
        <header className="devmail-head">
          <div>
            <p className="eyebrow">DEVELOPMENT MAILBOX</p>
            <h1>开发邮件箱</h1>
            <p className="muted">仅开发环境可见。验证邮件不会真的发到外部邮箱。</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            刷新
          </button>
        </header>

        {loading ? (
          <p className="muted">正在读取邮件…</p>
        ) : disabled ? (
          <div className="state-card">
            <h3>开发邮件箱未启用</h3>
            <p>当前环境关闭了开发邮件箱。生产环境请使用真实 SMTP（Day 21 接入）。</p>
            <Link to="/" className="btn btn-primary btn-sm">
              回到广场
            </Link>
          </div>
        ) : error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="state-card">
            <h3>还没有开发邮件</h3>
            <p>注册一个新账号后，验证邮件会出现在这里。</p>
            <Link to="/login" className="btn btn-primary btn-sm">
              去注册
            </Link>
          </div>
        ) : (
          <ul className="devmail-list">
            {items.map((item) => (
              <li key={item.id} className="devmail-item">
                <div className="devmail-meta">
                  <span className="tag tag-accent">
                    {item.kind === 'password_reset' ? '重置密码' : '验证邮箱'}
                  </span>
                  <span>{item.to}</span>
                  <span className="devmail-time">{timeAgo(item.createdAt)}</span>
                </div>
                <h2>{item.subject}</h2>
                <p className="devmail-text">{item.text}</p>
                <div className="devmail-foot">
                  <span className="muted">
                    发送于 {fullDate(item.createdAt)} · 有效期至 {fullDate(item.expiresAt)}
                  </span>
                  <div className="devmail-actions">
                    <button type="button" className="text-btn" onClick={() => void copyLink(item)}>
                      复制链接
                    </button>
                    <a href={item.link} className="btn btn-primary btn-sm">
                      {item.kind === 'password_reset' ? '打开重置链接' : '打开验证链接'}
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  )
}
