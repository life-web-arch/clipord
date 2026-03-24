import { useState, useEffect } from 'react'
import { supabase } from '@shared/supabase'
import { Spinner } from '../components/ui/Spinner'

/**
 * Handles Supabase password reset redirect.
 *
 * Supabase sends the user to: /reset-password#access_token=...&type=recovery
 * This page intercepts the hash tokens, establishes a session,
 * then allows the user to set a new password.
 *
 * For OTP-based apps (no password), we instead treat this as
 * a "re-verify email" flow — the user just needs to click the link
 * to confirm their identity, and we redirect them to the app.
 */
export function ResetPassword() {
  const [status, setStatus]     = useState<'loading' | 'ready' | 'success' | 'error'>('loading')
  const [error, setError]       = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)

  useEffect(() => {
    // Supabase puts the tokens in the URL hash
    const hash = window.location.hash
    const params = new URLSearchParams(hash.slice(1))
    const type = params.get('type')
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (type === 'recovery' && accessToken && refreshToken) {
      setIsRecovery(true)
      // Set the session from the recovery tokens
      supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken,
      }).then(({ error: sessionErr }) => {
        if (sessionErr) {
          setError('Invalid or expired reset link. Please request a new one.')
          setStatus('error')
        } else {
          setStatus('ready')
        }
      }).catch(() => {
        setError('Failed to process reset link.')
        setStatus('error')
      })
    } else {
      // Not a recovery link — might be a magic link or other type
      // Check if we have a session
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          // User is logged in via magic link, redirect to app
          window.location.href = '/'
        } else {
          setError('Invalid reset link. Please request a new one from the app.')
          setStatus('error')
        }
      })
    }
  }, [])

  const handleSetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError(null)
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
    } else {
      setStatus('success')
      setLoading(false)
      // Sign out and redirect to app after 2 seconds
      setTimeout(async () => {
        await supabase.auth.signOut()
        window.location.href = '/'
      }, 2000)
    }
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-clipord-600 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">📋</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Clipord</h1>
        </div>

        {status === 'loading' && (
          <div className="text-center">
            <Spinner size="lg" />
            <p className="text-white/40 text-sm mt-4">Processing reset link…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="text-4xl mb-4">❌</div>
            <p className="text-white font-semibold mb-2">Reset link invalid</p>
            <p className="text-white/40 text-sm mb-6">{error}</p>
            <a href="/" className="btn-primary px-6 py-2.5 inline-block">Go to app</a>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-white font-semibold mb-2">Password updated!</p>
            <p className="text-white/40 text-sm">Redirecting you to sign in…</p>
          </div>
        )}

        {status === 'ready' && isRecovery && (
          <>
            <h2 className="text-xl font-bold text-white mb-2">Set new password</h2>
            <p className="text-white/40 text-sm mb-6">
              Choose a strong password. You'll use this to sign into Clipord.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="input-field mb-3"
              autoFocus
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
              placeholder="Confirm new password"
              className="input-field mb-4"
              autoComplete="new-password"
            />
            <button
              onClick={handleSetPassword}
              disabled={loading || !newPassword || !confirmPassword}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : 'Set password & sign in'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
