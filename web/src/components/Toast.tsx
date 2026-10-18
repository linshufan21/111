import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Tone = 'default' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: Tone
}

interface ToastValue {
  notify: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const notify = useCallback((message: string, tone: Tone = 'default') => {
    const id = ++seq.current
    setItems((list) => [...list, { id, message, tone }])
    window.setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id))
    }, 2800)
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
