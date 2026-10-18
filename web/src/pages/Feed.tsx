import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Question, SortKey } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { usePostingGate } from '../auth/usePostingGate'
import { Avatar } from '../components/Avatar'
import { Layout } from '../components/Layout'
import { PublishModal } from '../components/PublishModal'
import { QuestionCard } from '../components/QuestionCard'
import { useToast } from '../components/Toast'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'hot', label: '热门' },
  { key: 'new', label: '最新' },
  { key: 'controversial', label: '最有争议' },
  { key: 'closing', label: '即将截止' },
]

const CATEGORIES = ['全部', '消费', '生活', '工作', '关系', '其他']

function FeedSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="qcard skeleton-card" key={i}>
          <div className="skeleton skeleton-line w40" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line w80" />
          <div className="skeleton skeleton-bar" />
        </div>
      ))}
    </div>
  )
}

export function Feed() {
  const { user } = useAuth()
  const needVerify = usePostingGate()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const composeOpen = params.get('compose') === '1'

  const [sort, setSort] = useState<SortKey>('hot')
  const [category, setCategory] = useState('全部')
  const [items, setItems] = useState<Question[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(q)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    setSearch(q)
  }, [q])

  useEffect(() => {
    if (!composeOpen || !needVerify) return
    const next = new URLSearchParams(params)
    next.delete('compose')
    setParams(next, { replace: true })
    notify('验证邮箱后才能发起投票', 'error')
    navigate('/settings#email')
  }, [composeOpen, needVerify])

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    setError('')
    api
      .listQuestions({
        sort,
        category: category === '全部' ? 'all' : category,
        q,
        limit: 8,
      })
      .then((res) => {
        if (id !== seq.current) return
        setItems(res.items)
        setCursor(res.nextCursor)
      })
      .catch((err) => {
        if (id !== seq.current) return
        setError(err instanceof ApiError ? err.message : '加载失败，请稍后再试')
      })
      .finally(() => {
        if (id === seq.current) setLoading(false)
      })
  }, [sort, category, q, reloadKey])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await api.listQuestions({
        sort,
        category: category === '全部' ? 'all' : category,
        q,
        cursor,
        limit: 8,
      })
      setItems((prev) => [...prev, ...res.items])
      setCursor(res.nextCursor)
    } catch {
      setError('加载更多失败，请重试')
    } finally {
      setLoadingMore(false)
    }
  }

  function updateQuestion(next: Question) {
    setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)))
  }

  function openCompose() {
    if (needVerify) {
      notify('验证邮箱后才能发起投票', 'error')
      navigate('/settings#email')
      return
    }
    const next = new URLSearchParams(params)
    next.set('compose', '1')
    setParams(next)
  }

  function closeCompose() {
    const next = new URLSearchParams(params)
    next.delete('compose')
    setParams(next, { replace: true })
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const next = new URLSearchParams(params)
    if (search.trim()) next.set('q', search.trim())
    else next.delete('q')
    setParams(next)
  }

  const trending = [...items].sort((a, b) => b.counts.total - a.counts.total).slice(0, 3)

  return (
    <Layout>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">THE PUBLIC BALLOT</p>
          <h1>今天，你在纠结什么？</h1>
          <p className="hero-lede">
            把「要不要」写下来，让真实的人投一票，并留下他们的理由。
            没有标准答案，只有更多视角。
          </p>
        </div>

        <button type="button" className="composer" onClick={openCompose}>
          <Avatar name={user?.username ?? '?'} hue={user?.avatarHue ?? 200} size={38} />
          <span className="composer-placeholder">
            {needVerify
              ? '验证邮箱后，就能发起投票…'
              : user
                ? `${user.username}，说一件你正在纠结的事…`
                : '登录后，说出你正在纠结的事…'}
          </span>
          <span className="composer-cta">{needVerify ? '去验证' : '发起投票'}</span>
        </button>
      </section>

      <div className="feed-layout">
        <section aria-label="问题列表">
          <div className="feed-toolbar">
            <form className="feed-search" onSubmit={submitSearch} role="search">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索问题或关键词"
                aria-label="搜索问题"
              />
              <button type="submit" className="text-btn">
                搜索
              </button>
            </form>

            <div className="segment sort-tabs" role="tablist" aria-label="排序">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={sort === s.key}
                  className={`segment-item${sort === s.key ? ' on' : ''}`}
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="chip-row category-row">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${category === c ? ' chip-on' : ''}`}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
              >
                {c}
              </button>
            ))}
          </div>

          {q ? (
            <p className="search-note">
              「{q}」的搜索结果
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.delete('q')
                  setParams(next)
                }}
              >
                清除
              </button>
            </p>
          ) : null}

          {loading ? (
            <FeedSkeleton />
          ) : error ? (
            <div className="state-card" role="alert">
              <h3>没有加载成功</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                重新加载
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="state-card">
              <h3>这里还很安静</h3>
              <p>{q ? '换个关键词试试，或者成为第一个提问的人。' : '成为第一个把纠结交给大家的人。'}</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={openCompose}>
                发起第一个投票
              </button>
            </div>
          ) : (
            <>
              <div className="feed-list">
                {items.map((question) => (
                  <QuestionCard key={question.id} question={question} onUpdate={updateQuestion} />
                ))}
              </div>
              {cursor ? (
                <div className="load-more">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? '加载中…' : '加载更多'}
                  </button>
                </div>
              ) : (
                <p className="feed-end">已经到底了 · 每一个问题都值得被认真对待</p>
              )}
            </>
          )}
        </section>

        <aside className="feed-aside" aria-label="侧栏">
          <div className="aside-card">
            <h2>今日热议</h2>
            {trending.length ? (
              <ol className="trend-list">
                {trending.map((item, index) => (
                  <li key={item.id}>
                    <span className="trend-index">0{index + 1}</span>
                    <a href={`/q/${item.id}`}>{item.title}</a>
                    <span className="trend-count">{item.counts.total} 票</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">等大家投出第一票。</p>
            )}
          </div>

          <div className="aside-card aside-rules">
            <h2>怎么玩</h2>
            <ul>
              <li>一次只问一个「要不要」。</li>
              <li>投票后才会看到比例，减少从众。</li>
              <li>理由比立场更重要，说人话。</li>
              <li>匿名是权利，友善是义务。</li>
            </ul>
          </div>

          <div className="aside-stamp" aria-hidden="true">
            <span>你的纠结</span>
            <strong>值得被听见</strong>
          </div>
        </aside>
      </div>

      <PublishModal
        open={composeOpen}
        onClose={closeCompose}
        onCreated={() => {
          /* 发布后由弹窗负责跳转详情 */
        }}
      />
    </Layout>
  )
}
