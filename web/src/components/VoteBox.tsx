import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Choice, Question } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { pct } from '../lib/format'
import { Button } from './Button'
import { useToast } from './Toast'

interface Props {
  question: Question
  onUpdate: (question: Question) => void
  size?: 'card' | 'detail'
  revealed?: boolean
  onReveal?: () => void
}

export function VoteBox({ question, onUpdate, size = 'card', revealed: controlledReveal, onReveal }: Props) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { notify } = useToast()

  const [mode, setMode] = useState<'idle' | 'reason'>('idle')
  const [choice, setChoice] = useState<Choice | null>(null)
  const [reason, setReason] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localReveal, setLocalReveal] = useState(false)

  const revealed = controlledReveal ?? localReveal
  const reveal = () => {
    if (onReveal) onReveal()
    else setLocalReveal(true)
  }

  const counts = question.counts
  const showResults = Boolean(question.myVote) || revealed || question.status === 'closed'
  const yesPct = pct(counts.yes, counts.total)
  const noPct = counts.total ? 100 - yesPct : 0

  function startVote(next: Choice) {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
      return
    }
    if (question.status === 'closed') return
    setChoice(next)
    setReason(question.myVote?.reason ?? '')
    setAnonymous(Boolean(question.myVote?.anonymous))
    setMode('reason')
  }

  async function submit() {
    if (!choice || busy) return
    const previous = question
    const nextCounts = { ...counts }
    if (previous.myVote) {
      nextCounts[previous.myVote.choice] = Math.max(0, nextCounts[previous.myVote.choice] - 1)
    } else {
      nextCounts.total += 1
    }
    nextCounts[choice] += 1
    const hadReason = Boolean(previous.myVote?.reason)
    nextCounts.reasons = Math.max(0, nextCounts.reasons + (reason.trim() ? 1 : 0) - (hadReason ? 1 : 0))

    onUpdate({
      ...previous,
      counts: nextCounts,
      myVote: { choice, reason: reason.trim(), anonymous },
    })
    setBusy(true)
    try {
      const { question: updated } = await api.vote(previous.id, {
        choice,
        reason: reason.trim(),
        anonymous,
      })
      onUpdate(updated)
      setMode('idle')
      notify(previous.myVote ? '已更新你的选择' : '投票成功，谢谢你的理由', 'success')
    } catch (err) {
      onUpdate(previous)
      if (err instanceof ApiError && err.status === 401) {
        notify('登录已过期，请重新登录后再投票', 'error')
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
        return
      }
      const message = err instanceof ApiError ? err.message : '投票失败，请稍后再试'
      notify(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (question.status === 'closed' && !counts.total) {
    return <p className="vote-closed">这个问题已截止，还没有人投票。</p>
  }

  if (mode === 'reason' && choice) {
    return (
      <div className={`vote-editor vote-editor-${choice}`}>
        <div className="vote-editor-head">
          <span className={`choice-pill choice-${choice}`}>{choice === 'yes' ? '是' : '否'}</span>
          <strong>说一句你的理由</strong>
          <span className="muted">可选</span>
        </div>
        <textarea
          className="vote-reason"
          value={reason}
          maxLength={200}
          rows={3}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          placeholder={choice === 'yes' ? '为什么支持？你的经验会帮到 TA。' : '为什么反对？说说你的顾虑。'}
          aria-label="投票理由（可选）"
        />
        <div className="vote-editor-foot">
          <label className="check">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            匿名投票
          </label>
          <span className="counter">{reason.length}/200</span>
          <div className="vote-editor-actions">
            <button type="button" className="text-btn" onClick={() => setMode('idle')} disabled={busy}>
              取消
            </button>
            <Button size="sm" loading={busy} onClick={submit}>
              {question.myVote ? '更新选择' : '提交投票'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`votebox votebox-${size}`}>
      {showResults ? (
        <div className="results">
          <div className="result-head">
            <span className="result-yes">是 {yesPct}%</span>
            <span className="result-total">{counts.total} 人投票</span>
            <span className="result-no">否 {noPct}%</span>
          </div>
          <div
            className="result-bar"
            role="img"
            aria-label={`是 ${counts.yes} 票，否 ${counts.no} 票`}
          >
            <span className="result-bar-yes" style={{ width: `${counts.total ? yesPct : 50}%` }} />
            <span className="result-bar-no" style={{ width: `${counts.total ? noPct : 50}%` }} />
          </div>
          <div className="result-foot">
            <span>
              {counts.yes} 是 · {counts.no} 否
            </span>
            {question.myVote ? (
              <span className={`my-vote my-vote-${question.myVote.choice}`}>
                你选了「{question.myVote.choice === 'yes' ? '是' : '否'}」
              </span>
            ) : (
              <span className="muted">你还没有投票</span>
            )}
            {question.status === 'open' ? (
              <button
                type="button"
                className="text-btn"
                onClick={() => startVote(question.myVote?.choice === 'yes' ? 'no' : 'yes')}
              >
                {question.myVote ? '改票' : '去投票'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="vote-prompt">
            {counts.total > 0 ? `已有 ${counts.total} 人投票` : '还没有人投票，来做第一个'}
            <span className="muted"> · 投票后可见结果</span>
          </div>
          <div className="vote-buttons">
            <button type="button" className="vote-btn vote-btn-yes" onClick={() => startVote('yes')}>
              <span className="vote-btn-mark" aria-hidden="true">
                ✓
              </span>
              是，支持
            </button>
            <button type="button" className="vote-btn vote-btn-no" onClick={() => startVote('no')}>
              <span className="vote-btn-mark" aria-hidden="true">
                ✕
              </span>
              否，反对
            </button>
          </div>
          {counts.total > 0 ? (
            <button type="button" className="text-btn reveal-btn" onClick={reveal}>
              先看结果
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
