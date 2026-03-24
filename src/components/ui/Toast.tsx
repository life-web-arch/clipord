import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  type?:   'success' | 'error' | 'info'
  onDismiss: () => void
  duration?: number
}

export function Toast({ message, type = 'info', onDismiss, duration = 3000 }: ToastProps) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setLeaving(true)
      setTimeout(onDismiss, 200)
    }, duration)
    return () => clearTimeout(t)
  }, [duration, onDismiss])

  const colors = {
    success: 'bg-green-500/20 border-green-500/40 text-green-300',
    error:   'bg-red-500/20 border-red-500/40 text-red-300',
    info:    'bg-clipord-500/20 border-clipord-500/40 text-clipord-300',
  }

  return (
    <div className={`
      fixed bottom-6 left-1/2 -translate-x-1/2 z-50
      px-4 py-3 rounded-xl border text-sm font-medium
      ${colors[type]}
      ${leaving ? 'animate-toast-out' : 'animate-toast-in'}
    `}>
      {message}
    </div>
  )
}
