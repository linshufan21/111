import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface BaseProps {
  label: string
  error?: string
  hint?: string
}

interface InputProps extends BaseProps, InputHTMLAttributes<HTMLInputElement> {
  as?: 'input'
}

interface TextareaProps extends BaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  as: 'textarea'
}

type Props = InputProps | TextareaProps

export function Field(props: Props) {
  const autoId = useId()
  const { label, error, hint, as = 'input', className = '', ...rest } = props
  const id = rest.id || autoId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {as === 'textarea' ? (
        <textarea
          id={id}
          className={`field-control field-textarea ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          className={`field-control ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
