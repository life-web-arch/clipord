import { useState } from 'react'
import { TOTP, Secret } from 'otpauth' // <-- CORRECT, NAMED IMPORT
import { sendPasswordResetEmail } from '@shared/supabase'
import { retrieveTOTPSecret } from '@shared/crypto'
import { Spinner } from '../ui/Spinner'

interface Props {
  accountId:   string
  email:       string
  cryptoKey:   CryptoKey | null
  onRecovered: () => void
  onBack:      () => void
}

export function ForgotAccess({ accountId, email, cryptoKey, onRecovered, onBack }: Props) {
  const [mode, setMode]           = useState<'choose' | 'totp' | 'email'>('choose')
  const [code, setCode]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  const handleTOTP = async () => {
    setLoading(true)
    setError(null)
    try {
      let secret: string | null = null
      if (cryptoKey) {
        secret = await retrieveTOTPSecret(accountId, cryptoKey)
      } else {
        secret = localStorage.getItem(`clipord_totp_${accountId}`)
      }
      if (!secret) { setError('No authenticator configured for this account'); setLoading(false); return }

      const totp = new TOTP({
        issuer: 'Clipord', label: email, algorithm: 'SHA1',
        digits: 6, period: 30,
        secret: Secret.fromBase32(secret), // <-- CORRECT USAGE
      })
      const delta = totp.validate({ token: code, window: 1 })
      if (delta === null) {
        setError('Invalid code. Check your authenticator app.')
      } else {
        onRecovered()
      }
    } catch {
      setError('Verification failed. Please try again.')
    }
    setLoading(false)
  }

  const handleEmailReset = async () => {
    setLoading(true)
    setError(null)
    const redirectTo = window.location.origin + '/reset-password'
    const { error: err } = await sendPasswordResetEmail(email, redirectTo)
    if (err) { setError(err) } else { setEmailSent(true) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <button
          onClick={onBack}
          className="text-white/40 text-sm mb-8 hover:text-white/60 transition-colors flex items-center gap-1"
        >
          ← Back
        </button>

        {mode === 'choose' && (
          <>
            <h2 className="text-2xl font-bold text-white mb-2">Can't get in?</h2>
            <p className="text-white/40 text-sm mb-8">How would you like to recover access?</p>
            <div className="space-y-3">
              <button
                onClick={() => setMode('totp')}
                className="w-full card text-left hover:bg-dark-100 transition-colors"
              >
                <p className="text-white font-medium">🔑 I have my authenticator app</p>
                <p className="text-white/40 text-sm mt-1">Enter your TOTP code to get back in</p>
              </button>
              <button
                onClick={() => setMode('email')}
                className="w-full card text-left hover:bg-dark-100 transition-colors"
              >
                <p className="text-white font-medium">📧 Reset via email</p>
                <p className="text-white/40 text-sm mt-1">
                  We'll send a reset link to <span className="text-white/60">{email}</span>
                </p>
              </button>
            </div>
          </>
        )}

        {mode === 'totp' && (
          <>
            <h2 className="text-2xl font-bold text-white mb-2">Authenticator code</h2>
            <p className="text-white/40 text-sm mb-8">Enter the 6-digit code from your app</p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleTOTP()}
              placeholder="000000"
              className="input-field mb-4 text-center text-2xl tracking-[0.5em] font-mono"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
            />
            <button
              onClick={handleTOTP}
              disabled={loading || code.length < 6}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : 'Verify'}
            </button>
          </>
        )}

        {mode === 'email' && (
          <>
            <h2 className="text-2xl font-bold text-white mb-2">Reset via email</h2>
            {!emailSent ? (
              <>
                <p className="text-white/40 text-sm mb-8">
                  A reset link will be sent to{' '}
                  <span className="text-white/70 font-medium">{email}</span>.
                  The link expires in 1 hour.
                </p>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}
                <button
                  onClick={handleEmailReset}
                  disabled={loading}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : 'Send reset link'}
                </button>
              </>
            ) : (
              <div className="text-center">
                <div className="text-5xl mb-4">📬</div>
                <p className="text-white font-medium mb-2">Reset link sent!</p>
                <p className="text-white/50 text-sm">
                  Check your inbox (and spam folder) for an email from Clipord.
                  Click the link in the email to set a new password.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
