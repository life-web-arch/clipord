import { useState } from 'react'
import { sendEmailOTP, verifyEmailOTP } from '@shared/supabase'
import { Spinner } from '../ui/Spinner'

interface Props {
  onVerified: (email: string, userId: string) => void
  onBack:     () => void
}

export function EmailOTP({ onVerified, onBack }: Props) {
  const [email, setEmail]       = useState('')
  const [otp, setOtp]           = useState('')
  const [step, setStep]         = useState<'email' | 'otp'>('email')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleSendOTP = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    const { error: err } = await sendEmailOTP(email.trim().toLowerCase())
    if (err) {
      setError(err)
    } else {
      setStep('otp')
    }
    setLoading(false)
  }

  const handleVerifyOTP = async () => {
    if (!otp.trim()) return
    setLoading(true)
    setError(null)
    const { error: err } = await verifyEmailOTP(email.trim().toLowerCase(), otp.trim())
    if (err) {
      setError(err)
    } else {
      const { getCurrentUser } = await import('@shared/supabase')
      const user = await getCurrentUser()
      if (user) onVerified(email.trim().toLowerCase(), user.id)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="text-white/40 text-sm mb-8 hover:text-white/60 transition-colors">
          ← Back
        </button>

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">
            {step === 'email' ? 'Enter your email' : 'Check your email'}
          </h2>
          <p className="text-white/40 text-sm mt-2">
            {step === 'email'
              ? 'We\'ll send a one-time code to verify it\'s you'
              : `We sent a code to ${email}`}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {step === 'email' ? (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
              placeholder="you@example.com"
              className="input-field mb-4"
              autoFocus
              autoComplete="email"
            />
            <button
              onClick={handleSendOTP}
              disabled={loading || !email.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
              placeholder="6-digit code"
              className="input-field mb-2 text-center text-xl tracking-widest font-mono"
              autoFocus
              inputMode="numeric"
              maxLength={6}
            />
            <p className="text-white/30 text-xs text-center mb-4">
              Didn't receive it?{' '}
              <button onClick={() => { setStep('email'); setOtp('') }} className="text-clipord-400 hover:underline">
                Resend
              </button>
            </p>
            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length < 6}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : 'Verify'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
