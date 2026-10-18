import { Link } from 'react-router-dom'
import type { Question } from '../api/types'
import { deadline, timeAgo } from '../lib/format'
import { Avatar } from './Avatar'
import { VoteBox } from './VoteBox'

interface Props {
  question: Question
  onUpdate: (question: Question) => void
  compact?: boolean
}

export function QuestionCard({ question, onUpdate, compact = false }: Props) {
  const dl = deadline(question.closesAt)
  const authorName = question.author?.username ?? '匿名发起'

  return (
    <article className={`qcard${compact ? ' qcard-compact' : ''}`}>
      <header className="qcard-head">
        <Avatar name={authorName} hue={question.author?.avatarHue ?? 200} size={32} />
        <div className="qcard-byline">
          <strong>{authorName}</strong>
          <span>
            {timeAgo(question.createdAt)} · {question.category}
          </span>
        </div>
        <div className="qcard-tags">
          {question.featured ? <span className="tag tag-accent">精选</span> : null}
          {question.isMine ? <span className="tag tag-accent">我发起的</span> : null}
          {question.status === 'closed' ? (
            <span className="tag">已截止</span>
          ) : dl?.urgent ? (
            <span className="tag tag-warn">{dl.label}</span>
          ) : null}
        </div>
      </header>

      <h3 className="qcard-title">
        <Link to={`/q/${question.id}`}>{question.title}</Link>
      </h3>

      {question.description && !compact ? (
        <p className="qcard-desc">{question.description}</p>
      ) : null}

      <VoteBox question={question} onUpdate={onUpdate} />

      <footer className="qcard-foot">
        <Link to={`/q/${question.id}`} className="qcard-reasons">
          {question.counts.reasons > 0
            ? `${question.counts.reasons} 条理由`
            : '还没有人写理由'}
        </Link>
        {!question.isMine ? (
          <Link to={`/q/${question.id}?report=1`} className="qcard-report">
            举报
          </Link>
        ) : null}
        <Link to={`/q/${question.id}`} className="qcard-more">
          查看详情 →
        </Link>
      </footer>
    </article>
  )
}
