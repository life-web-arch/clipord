import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, updatePassword } from '@shared/supabase'
import { Spinner } from '../components/ui/Spinner'

export function ResetPassword() {
  const navigate                    = useNavigate()
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState(false)

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash as #access_token=...&type=recovery
    // The SDK handles this automatically via detectSessionInUrl: true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true)
      }
      if (event === 'SIGNED_IN') {
        setSessionReady(true)
      }
    })

    // Also check if we already have a session (redirect already happened)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true)
      else {
        // Give it 3 seconds for the hash to be processed
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: d }) => {
            if (d.session) setSessionReady(true)
            else setSessionError(true)
          })
        }, 3000)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async () => {
    if (!password.trim()) { setError('Enter a new password'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }

    setLoading(true)
    setError(null)

    const { error: err } = await updatePassword(password)
    if (err) {
      setError(err)
    } else {
      setSuccess(true)
      setTimeout(() => navigate('/'), 3000)
    }
    setLoading(false)
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-dark-0 flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-white mb-2">Link expired or invalid</h2>
          <p className="text-white/40 text-sm mb-6">
            This reset link has expired or already been used. Request a new one.
          </p>
          <a href="/" className="btn-primary px-6 py-2.5 inline-block">Back to app</a>
        </div>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-dark-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-white/40 text-sm">Verifying reset link…</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-dark-0 flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
          <p className="text-white/40 text-sm">Redirecting you to the app…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-clipord-600 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">📋</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Set new password</h2>
          <p className="text-white/40 text-sm mt-2">Choose a strong password for your account</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 8 chars)"
          className="input-field mb-3"
          autoFocus
          autoComplete="new-password"
          minLength={8}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleReset()}
          placeholder="Confirm new password"
          className="input-field mb-4"
          autoComplete="new-password"
        />

        <button
          onClick={handleReset}
          disabled={loading || !password || !confirm}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? <Spinner size="sm" /> : 'Update password'}
        </button>
      </div>
    </div>
  )
}
