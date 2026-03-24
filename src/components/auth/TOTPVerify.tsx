import { useState } from 'react'
import * as OTPAuth from 'otpauth'
import { Spinner } from '../ui/Spinner'

interface Props {
  accountId:  string
  email:      string
  onVerified: () => void
  onForgot:   () => void
}

export function TOTPVerify({ accountId, email, onVerified, onForgot }: Props) {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleVerify = async () => {
    setLoading(true)
    setError(null)
    const secret = localStorage.getItem(`clipord_totp_${accountId}`)
    if (!secret) {
      setError('TOTP not configured for this account')
      setLoading(false)
      return
    }
    const totp = new OTPAuth.TOTP({
      issuer:    'Clipord',
      label:     email,
      algorithm: 'SHA1',
      digits:    6,
      period:    30,
      secret:    OTPAuth.Secret.fromBase32(secret),
    })
    const delta = totp.validate({ token: code, window: 1 })
    if (delta === null) {
      setError('Incorrect code. Try again.')
    } else {
      onVerified()
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-clipord-600/20 border border-clipord-600/30 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">🔑</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Verify it's you</h2>
          <p className="text-white/40 text-sm mt-2 text-center">{email}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <p className="text-white/40 text-sm mb-3 text-center">
          Enter the code from your authenticator app
        </p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          placeholder="000000"
          className="input-field mb-4 text-center text-2xl tracking-[0.5em] font-mono"
          inputMode="numeric"
          maxLength={6}
          autoFocus
        />

        <button
          onClick={handleVerify}
          disabled={loading || code.length < 6}
          className="btn-primary w-full flex items-center justify-center gap-2 mb-4"
        >
          {loading ? <Spinner size="sm" /> : 'Verify'}
        </button>

        <button
          onClick={onForgot}
          className="w-full text-center text-white/30 text-sm hover:text-white/50 transition-colors py-2"
        >
          Can't get in?
        </button>
      </div>
    </div>
  )
}
