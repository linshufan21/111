import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Category, Question } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'
import { useToast } from './Toast'

const CATEGORIES: Category[] = ['消费', '生活', '工作', '关系', '其他']

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (question: Question) => void
}

type DeadlineKey = '24h' | '3d' | '7d' | 'none'

const DEADLINES: { key: DeadlineKey; label: string; hours: number | null }[] = [
  { key: '24h', label: '24 小时', hours: 24 },
  { key: '3d', label: '3 天', hours: 72 },
  { key: '7d', label: '7 天', hours: 168 },
  { key: 'none', label: '不设截止', hours: null },
]

export function PublishModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<Category>('生活')
  const [deadlineKey, setDeadlineKey] = useState<DeadlineKey>('3d')
  const [anonymous, setAnonymous] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setErrors({})
      setServerError('')
    }
  }, [open])

  useEffect(() => {
    if (!user && open) {
      onClose()
      navigate('/login?next=/?compose=1')
    }
  }, [user, open, onClose, navigate])

  async function submit() {
    const next: Record<string, string> = {}
    if (title.trim().length < 4) next.title = '至少写 4 个字，把问题说清楚'
    if (title.trim().length > 80) next.title = '标题最多 80 个字'
    if (description.length > 500) next.description = '补充说明最多 500 个字'
    setErrors(next)
    if (Object.keys(next).length) return

    const hours = DEADLINES.find((d) => d.key === deadlineKey)?.hours ?? null
    const closesAt = hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null
    setBusy(true)
    setServerError('')
    try {
      const { question } = await api.createQuestion({
        title: title.trim(),
        description: description.trim(),
        category,
        closesAt,
        anonymous,
      })
      onCreated(question)
      notify('问题已发布，等大家来投票', 'success')
      setTitle('')
      setDescription('')
      setAnonymous(false)
      onClose()
      navigate(`/q/${question.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.field) setErrors({ [err.field]: err.message })
        else setServerError(err.message)
      } else {
        setServerError('发布失败，请稍后再试')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="发起一个决定" subtitle="把纠结写成一道是/否题，剩下的交给大家。" size="md">
      <form
        className="publish-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {serverError ? (
          <div className="alert" role="alert">
            {serverError}
          </div>
        ) : null}

        <Field
          label="你的问题"
          placeholder="例如：我要不要买 iPhone 18？"
          value={title}
          maxLength={80}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
          hint={`${title.length}/80 · 只写一个「要不要」的问题`}
        />

        <Field
          as="textarea"
          label="补充背景（可选）"
          placeholder="预算、顾虑、已经尝试过的办法……写清楚更容易得到好建议。"
          value={description}
          maxLength={500}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          hint={`${description.length}/500`}
        />

        <fieldset className="field">
          <legend className="field-label">分类</legend>
          <div className="chip-row">
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
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">投票截止</legend>
          <div className="segment">
            {DEADLINES.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`segment-item${deadlineKey === d.key ? ' on' : ''}`}
                onClick={() => setDeadlineKey(d.key)}
                aria-pressed={deadlineKey === d.key}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="check check-block">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          匿名发起（不在卡片上显示你的昵称）
        </label>

        <div className="publish-preview">
          <span className="preview-label">预览</span>
          <h4>{title.trim() || '你的问题会出现在这里'}</h4>
          <p>{description.trim() || '补充背景会显示在问题下方。'}</p>
        </div>

        <div className="publish-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            发布问题
          </Button>
        </div>
      </form>
    </Modal>
  )
}
