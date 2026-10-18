import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Choice, Question as QuestionType, Reason, Report, ReportReason } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Layout } from '../components/Layout'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { VoteBox } from '../components/VoteBox'
import { deadline, fullDate, pct, timeAgo } from '../lib/format'
import { REPORT_REASONS, reportReasonLabel, reportStatusLabel } from '../lib/reports'

type Filter = 'all' | Choice

export function Question() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const { notify } = useToast()
  const [question, setQuestion] = useState<QuestionType | null>(null)
  const [reasons, setReasons] = useState<Reason[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [revealed, setRevealed] = useState(false)
  const [myReport, setMyReport] = useState<Report | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>('spam')
  const [reportDetail, setReportDetail] = useState('')
  const [reportError, setReportError] = useState('')
  const [reportSending, setReportSending] = useState(false)

  useEffect(() => {
    if (params.get('report') !== '1') return
    setReportOpen(true)
    const next = new URLSearchParams(params)
    next.delete('report')
    setParams(next, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setMyReport(null)
    api
      .getQuestion(id)
      .then((res) => {
        if (!alive) return
        setQuestion(res.question)
        setReasons(res.reasons)
        setMyReport(res.myReport)
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof ApiError ? err.message : '加载失败，请稍后再试')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  function updateQuestion(next: QuestionType) {
    setQuestion(next)
    if (!user) return
    const text = next.myVote?.reason?.trim() ?? ''
    setReasons((prev) => {
      const rest = prev.filter((r) => !r.mine)
      if (!text || !next.myVote) return rest
      return [
        {
          choice: next.myVote.choice,
          reason: text,
          updatedAt: new Date().toISOString(),
          mine: true,
          author: next.myVote.anonymous
            ? null
            : { username: user.username, avatarHue: user.avatarHue },
        },
        ...rest,
      ]
    })
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      notify('链接已复制', 'success')
    } catch {
      notify('复制失败，请手动复制地址栏', 'error')
    }
  }

  function openReport() {
    setReportError('')
    setReportOpen(true)
  }

  async function submitReport() {
    if (!question) return
    if (!user) {
      setReportError('请先登录后再举报')
      return
    }
    setReportSending(true)
    setReportError('')
    try {
      const res = await api.reportQuestion(question.id, {
        reason: reportReason,
        detail: reportDetail.trim(),
      })
      setMyReport(res.report)
      setReportOpen(false)
      setReportDetail('')
      notify(
        res.duplicate ? '你已经举报过这个问题，记录已合并' : '举报已提交，等待管理员处理',
        'success',
      )
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : '举报失败，请稍后再试')
    } finally {
      setReportSending(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="detail-shell">
          <div className="skeleton skeleton-line w30" />
          <div className="skeleton skeleton-title lg" />
          <div className="skeleton skeleton-bar" />
        </div>
      </Layout>
    )
  }

  if (error || !question) {
    return (
      <Layout>
        <div className="state-card detail-state">
          <h3>这个问题不见了</h3>
          <p>{error || '可能已被删除，或者链接不完整。'}</p>
          <Link to="/" className="btn btn-primary btn-sm">
            回到广场
          </Link>
        </div>
      </Layout>
    )
  }

  const dl = deadline(question.closesAt)
  const visible = filter === 'all' ? reasons : reasons.filter((r) => r.choice === filter)
  const yesPct = pct(question.counts.yes, question.counts.total)
  const noPct = question.counts.total ? 100 - yesPct : 0
  const showTally = Boolean(question.myVote) || revealed || question.status === 'closed'
  const authorName = question.author?.username ?? '匿名发起'

  return (
    <Layout>
      <div className="detail-shell">
        <Link to="/" className="back-link">
          ← 回到广场
        </Link>

        <div className="detail-grid">
          <article className="detail-main">
            <header className="detail-head">
              <div className="detail-tags">
                <span className="tag tag-accent">{question.category}</span>
                {question.status === 'closed' ? (
                  <span className="tag">已截止</span>
                ) : dl ? (
                  <span className={`tag${dl.urgent ? ' tag-warn' : ''}`}>{dl.label}</span>
                ) : null}
                {question.isMine ? <span className="tag">我发起的</span> : null}
              </div>
              <h1>{question.title}</h1>
              {question.description ? <p className="detail-desc">{question.description}</p> : null}
              <div className="detail-byline">
                <Avatar name={authorName} hue={question.author?.avatarHue ?? 200} size={30} />
                <span>{authorName}</span>
                <span className="dot">·</span>
                <span>{timeAgo(question.createdAt)}</span>
                <span className="dot">·</span>
                <span>{question.counts.total} 人参与</span>
              </div>
            </header>

            <VoteBox
              question={question}
              onUpdate={updateQuestion}
              size="detail"
              revealed={revealed}
              onReveal={() => setRevealed(true)}
            />

            <section className="reasons" aria-labelledby="reasons-title">
              <div className="reasons-head">
                <h2 id="reasons-title">大家的理由</h2>
                <div className="segment" role="tablist" aria-label="理由筛选">
                  {(
                    [
                      ['all', '全部'],
                      ['yes', '是'],
                      ['no', '否'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={filter === key}
                      className={`segment-item${filter === key ? ' on' : ''}`}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {visible.length ? (
                <ul className="reason-list">
                  {visible.map((reason, index) => (
                    <li key={`${reason.updatedAt}-${index}`} className="reason-item">
                      <div className="reason-top">
                        <Avatar
                          name={reason.author?.username ?? '匿名'}
                          hue={reason.author?.avatarHue ?? 210}
                          size={30}
                        />
                        <strong>{reason.author?.username ?? '匿名用户'}</strong>
                        <span className={`choice-pill choice-${reason.choice}`}>
                          {reason.choice === 'yes' ? '是' : '否'}
                        </span>
                        <span className="reason-time">{timeAgo(reason.updatedAt)}</span>
                      </div>
                      <p>{reason.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="reasons-empty">
                  <p>{filter === 'all' ? '还没有人写理由。' : '这一边还没有理由，先投一票并说说你的想法？'}</p>
                </div>
              )}
            </section>
          </article>

          <aside className="detail-aside">
            <div className="aside-card tally-card">
              <span className="eyebrow">LIVE TALLY</span>
              {showTally ? (
                <>
                  <div className="tally-numbers">
                    <div className="tally-yes">
                      <strong>{yesPct}%</strong>
                      <span>是 · {question.counts.yes} 票</span>
                    </div>
                    <div className="tally-no">
                      <strong>{noPct}%</strong>
                      <span>否 · {question.counts.no} 票</span>
                    </div>
                  </div>
                  <div className="result-bar" aria-hidden="true">
                    <span className="result-bar-yes" style={{ width: `${question.counts.total ? yesPct : 50}%` }} />
                    <span className="result-bar-no" style={{ width: `${question.counts.total ? noPct : 50}%` }} />
                  </div>
                </>
              ) : (
                <div className="tally-locked">
                  <strong>?</strong>
                  <p>投票后揭晓比例，避免从众。</p>
                  <button type="button" className="text-btn" onClick={() => setRevealed(true)}>
                    先看结果
                  </button>
                </div>
              )}
              <dl className="tally-meta">
                <div>
                  <dt>总票数</dt>
                  <dd>{question.counts.total}</dd>
                </div>
                <div>
                  <dt>理由</dt>
                  <dd>{question.counts.reasons}</dd>
                </div>
                <div>
                  <dt>截止</dt>
                  <dd>{question.closesAt ? fullDate(question.closesAt) : '不设截止'}</dd>
                </div>
              </dl>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
                复制链接，邀请朋友投票
              </button>
            </div>

            <div className="aside-card">
              <h2>发起人</h2>
              <div className="detail-author">
                <Avatar name={authorName} hue={question.author?.avatarHue ?? 200} size={40} />
                <div>
                  <strong>{authorName}</strong>
                  <span>
                    {question.anonymous
                      ? '选择匿名发起'
                      : question.author?.deleted
                        ? '账号已注销，内容保留'
                        : '愿意为这个问题负责'}
                  </span>
                </div>
              </div>
            </div>

            <div className="aside-card report-card">
              <h2>社区互助</h2>
              {myReport ? (
                <>
                  <p className={`report-state report-${myReport.status}`}>
                    你已举报 · {reportStatusLabel(myReport.status)}
                  </p>
                  <p className="muted">
                    {reportReasonLabel(myReport.reason)}，感谢你帮助维护广场。
                  </p>
                </>
              ) : (
                <>
                  <p className="muted">广告、攻击、隐私或误导内容，可以交给管理员处理。</p>
                  <button type="button" className="text-btn report-trigger" onClick={openReport}>
                    举报这个问题
                  </button>
                </>
              )}
            </div>

            <div className="aside-stamp aside-stamp-small" aria-hidden="true">
              <span>认真投票</span>
              <strong>好好说话</strong>
            </div>
          </aside>
        </div>
      </div>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="举报这个问题"
        subtitle={question.title}
      >
        {myReport ? (
          <div className="report-done">
            <p className={`report-state report-${myReport.status}`}>
              已收到 · {reportStatusLabel(myReport.status)}
            </p>
            <p className="muted">
              你选择的是「{reportReasonLabel(myReport.reason)}」。管理员处理后会更新状态。
            </p>
            <div className="modal-actions">
              <Link to="/me?tab=reports" className="btn btn-ghost btn-sm">
                查看我的举报
              </Link>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setReportOpen(false)}>
                知道了
              </button>
            </div>
          </div>
        ) : !user ? (
          <div className="report-done">
            <p className="muted">举报需要登录，登录后可以查看处理进度。</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(false)}>
                取消
              </button>
              <Link to={`/login?next=/q/${question.id}`} className="btn btn-primary btn-sm">
                登录后举报
              </Link>
            </div>
          </div>
        ) : (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitReport()
            }}
          >
            <fieldset className="report-reasons">
              <legend>选择原因</legend>
              {REPORT_REASONS.map((item) => (
                <label key={item.value} className="report-reason">
                  <input
                    type="radio"
                    name="report-reason"
                    value={item.value}
                    checked={reportReason === item.value}
                    onChange={() => setReportReason(item.value)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <em>{item.hint}</em>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="field">
              <span className="field-label">补充说明（可选）</span>
              <textarea
                className="field-control field-textarea"
                value={reportDetail}
                maxLength={300}
                onChange={(e) => setReportDetail(e.target.value)}
                placeholder="例如：这条内容在评论区反复发广告链接。"
                rows={4}
              />
              <small className="field-hint">
                {reportReason === 'other' && reportDetail.trim().length < 5
                  ? '选择「其他」时请至少写 5 个字。'
                  : `${reportDetail.length}/300`}
              </small>
            </label>

            {reportError ? (
              <p className="field-error" role="alert">
                {reportError}
              </p>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(false)}>
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={
                  reportSending ||
                  (reportReason === 'other' && reportDetail.trim().length < 5)
                }
              >
                {reportSending ? '提交中…' : '提交举报'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  )
}
