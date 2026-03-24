import { useState, useEffect } from 'react'
import { TOTP, Secret } from 'otpauth' // <-- CORRECT, NAMED IMPORT
import { checkLockout, recordFailure, recordSuccess, formatLockoutTime } from '../../lib/bruteForce'
import { retrieveTOTPSecret } from '@shared/crypto'
import { Spinner } from '../ui/Spinner'

interface Props {
  accountId:  string
  email:      string
  cryptoKey:  CryptoKey | null
  onVerified: () => void
  onForgot:   () => void
}

export function TOTPVerify({ accountId, email, cryptoKey, onVerified, onForgot }: Props) {
  const [code, setCode]             = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [lockoutMs, setLockoutMs]   = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState(5)

  useEffect(() => {
    const { locked, remainingMs, attemptsLeft: left } = checkLockout(accountId)
    if (locked) {
      setLockoutMs(remainingMs)
      setError(`Too many failed attempts. Try again in ${formatLockoutTime(remainingMs)}.`)
    }
    setAttemptsLeft(left)
  }, [accountId])

  useEffect(() => {
    if (lockoutMs <= 0) return
    const interval = setInterval(() => {
      setLockoutMs((prev) => {
        const next = prev - 1000
        if (next <= 0) {
          setError(null)
          clearInterval(interval)
          return 0
        }
        setError(`Too many failed attempts. Try again in ${formatLockoutTime(next)}.`)
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [lockoutMs])

  const handleVerify = async () => {
    const lockCheck = checkLockout(accountId)
    if (lockCheck.locked) return

    if (!code.trim() || code.length < 6) return
    setLoading(true)
    setError(null)

    try {
      let secret: string | null = null
      if (cryptoKey) {
        secret = await retrieveTOTPSecret(accountId, cryptoKey)
      } else {
        secret = localStorage.getItem(`clipord_totp_${accountId}`)
      }

      if (!secret) {
        setError('Authenticator not configured for this account')
        setLoading(false)
        return
      }

      const totp = new TOTP({
        issuer: 'Clipord', label: email, algorithm: 'SHA1',
        digits: 6, period: 30,
        secret: Secret.fromBase32(secret), // <-- CORRECT USAGE
      })

      const delta = totp.validate({ token: code, window: 1 })

      if (delta === null) {
        const result = recordFailure(accountId)
        if (result.locked) {
          setLockoutMs(result.remainingMs)
          setError(`Too many failed attempts. Locked for ${formatLockoutTime(result.remainingMs)}.`)
        } else {
          setAttemptsLeft(result.attemptsLeft)
          setError(
            result.attemptsLeft === 1
              ? '⚠️ Incorrect code. 1 attempt remaining before lockout.'
              : `Incorrect code. ${result.attemptsLeft} attempts remaining.`
          )
        }
      } else {
        recordSuccess(accountId)
        onVerified()
      }
    } catch {
      setError('Verification failed. Please try again.')
    }

    setLoading(false)
  }

  const isLocked = lockoutMs > 0

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-clipord-600/20 border border-clipord-600/30 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">{isLocked ? '🔒' : '🔑'}</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Verify it's you</h2>
          <p className="text-white/40 text-sm mt-2 text-center">{email}</p>
        </div>

        {error && (
          <div className={`border rounded-xl px-4 py-3 mb-4 ${
            isLocked
              ? 'bg-red-500/20 border-red-500/50'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!isLocked && (
          <>
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
              disabled={isLocked}
              autoComplete="one-time-code"
            />
            <button
              onClick={handleVerify}
              disabled={loading || code.length < 6 || isLocked}
              className="btn-primary w-full flex items-center justify-center gap-2 mb-4"
            >
              {loading ? <Spinner size="sm" /> : 'Verify'}
            </button>
          </>
        )}

        {attemptsLeft < 5 && !isLocked && (
          <p className="text-yellow-400/70 text-xs text-center mb-4">
            ⚠️ {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining
          </p>
        )}

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
