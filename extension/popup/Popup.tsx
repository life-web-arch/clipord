import { useState, useEffect, useCallback } from 'react'
import browser from 'webextension-polyfill'
import * as OTPAuth from 'otpauth'
import {
  isSessionValid, setSession, clearSession,
  getRemainingMs, isLockedOut, recordFailedAttempt,
  clearBruteForce
} from '../lib/session'
import { loadEncryptedClips, clearEncryptedClips } from '../lib/extensionCrypto'
import { detectClipType, generatePreview, getClipTypeIcon } from '@shared/detector'
import { Spinner } from '../../src/components/ui/Spinner'

interface StoredAccount { id: string; email: string }
interface Clip {
  id: string; content: string; spaceId: string | null
  accountId: string; createdAt: string
}

type PopupStep = 'account-select' | 'verify' | 'clips'

export function Popup() {
  const [step, setStep]             = useState<PopupStep>('account-select')
  const [accounts, setAccounts]     = useState<StoredAccount[]>([])
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null)
  const [clips, setClips]           = useState<Clip[]>([])
  const [code, setCode]             = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [copied, setCopied]         = useState<string | null>(null)
  const [sessionRemaining, setSessionRemaining] = useState(0)
  const [attemptsLeft, setAttemptsLeft]         = useState(5)
  const [lockoutMs, setLockoutMs]               = useState(0)

  // Load accounts on mount
  useEffect(() => {
    browser.storage.local.get('clipord_accounts').then((result) => {
      const accs = (result.clipord_accounts as StoredAccount[] | undefined) ?? []
      setAccounts(accs)
    })
  }, [])

  // Session countdown
  useEffect(() => {
    if (step !== 'clips') return
    const interval = setInterval(() => {
      const remaining = getRemainingMs()
      setSessionRemaining(remaining)
      if (remaining <= 0) {
        clearSession()
        setStep('account-select')
        setClips([])
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [step])

  // Lockout countdown
  useEffect(() => {
    if (lockoutMs <= 0) return
    const interval = setInterval(() => {
      setLockoutMs((prev) => {
        const next = prev - 1000
        if (next <= 0) { setError(null); clearInterval(interval); return 0 }
        setError(`Locked. Try again in ${Math.ceil(next / 60000)}m.`)
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [lockoutMs])

  const handleSelectAccount = (account: StoredAccount) => {
    setActiveAccount(account)
    // Check if already has valid session
    if (isSessionValid(account.id)) {
      loadClips(account)
      setStep('clips')
      return
    }
    // Check lockout
    const lockCheck = isLockedOut(account.id)
    if (lockCheck.locked) {
      setLockoutMs(lockCheck.remainingMs)
      setError(`Locked. Try again in ${Math.ceil(lockCheck.remainingMs / 60000)}m.`)
    }
    setStep('verify')
  }

  const handleVerify = async () => {
    if (!activeAccount || !code || code.length < 6) return
    const lockCheck = isLockedOut(activeAccount.id)
    if (lockCheck.locked) return

    setLoading(true)
    setError(null)

    try {
      const secretKey  = `clipord_totp_${activeAccount.id}`
      const secret     = localStorage.getItem(secretKey)
      if (!secret) {
        setError('Authenticator not configured. Open Clipord app to set up.')
        setLoading(false)
        return
      }

      const totp = new OTPAuth.TOTP({
        issuer: 'Clipord', label: activeAccount.email,
        algorithm: 'SHA1', digits: 6, period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      })

      const delta = totp.validate({ token: code, window: 1 })

      if (delta === null) {
        const result = recordFailedAttempt(activeAccount.id)
        if (result.lockedOut) {
          setLockoutMs(result.lockedUntilMs! - Date.now())
          setError(`Too many attempts. Locked for 15 minutes.`)
        } else {
          setAttemptsLeft(result.attemptsLeft)
          setError(`Incorrect code. ${result.attemptsLeft} attempt${result.attemptsLeft !== 1 ? 's' : ''} left.`)
        }
      } else {
        clearBruteForce(activeAccount.id)
        setSession(activeAccount.id)
        await loadClips(activeAccount)
        setStep('clips')
      }
    } catch {
      setError('Verification failed.')
    }

    setCode('')
    setLoading(false)
  }

  const loadClips = async (account: StoredAccount) => {
    const loaded = await loadEncryptedClips(account.id)
    setClips((loaded as Clip[]).slice().reverse())
  }

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleDelete = async (id: string) => {
    if (!activeAccount) return
    const updated = clips.filter((c) => c.id !== id)
    setClips(updated)
    await clearEncryptedClips(activeAccount.id)
    // Re-save remaining
    const { saveEncryptedClips } = await import('../lib/extensionCrypto')
    await saveEncryptedClips(activeAccount.id, updated.slice().reverse())
  }

  const handleLock = () => {
    clearSession()
    setClips([])
    setStep('account-select')
    setCode('')
    setError(null)
  }

  const openApp = () => browser.tabs.create({ url: 'https://clipord.app' })

  const formatRemaining = (ms: number) => {
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // ---- Render ----

  if (step === 'account-select') {
    return (
      <div className="w-80 bg-dark-0 text-white font-sans">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-200">
          <div className="flex items-center gap-2">
            <span>📋</span>
            <span className="font-bold text-sm">Clipord</span>
          </div>
          <button onClick={openApp} className="text-xs text-clipord-400 hover:text-clipord-300">
            Open app →
          </button>
        </div>
        <div className="p-3 space-y-2">
          {accounts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-white/30 text-xs">No accounts. Open Clipord app to sign in.</p>
              <button onClick={openApp} className="btn-primary mt-4 text-sm px-6">Open app</button>
            </div>
          ) : (
            accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => handleSelectAccount(acc)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-dark-100 hover:bg-dark-200 transition-colors text-left"
              >
                <div className="w-8 h-8 bg-clipord-600/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-clipord-400 font-semibold text-xs">
                    {acc.email[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{acc.email}</p>
                  <p className="text-white/30 text-xs">
                    {isSessionValid(acc.id) ? '✓ Active session' : 'Tap to verify'}
                  </p>
                </div>
                <span className="text-white/20">›</span>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  if (step === 'verify' && activeAccount) {
    const locked = lockoutMs > 0
    return (
      <div className="w-80 bg-dark-0 text-white font-sans">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-200">
          <button onClick={() => { setStep('account-select'); setError(null) }}
            className="text-white/40 hover:text-white/60 text-sm">←</button>
          <span className="text-sm font-medium flex-1 truncate">{activeAccount.email}</span>
        </div>
        <div className="p-4">
          <div className="text-center mb-4">
            <span className="text-3xl">{locked ? '🔒' : '🔑'}</span>
            <p className="text-white/50 text-xs mt-2">Enter authenticator code</p>
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
          {!locked && (
            <>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                placeholder="000000"
                className="input-field text-center text-xl tracking-[0.4em] font-mono mb-3"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
              />
              <button
                onClick={handleVerify}
                disabled={loading || code.length < 6}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
              >
                {loading ? <Spinner size="sm" /> : 'Verify'}
              </button>
              {attemptsLeft < 5 && (
                <p className="text-yellow-400/70 text-xs text-center mt-2">
                  {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining
                </p>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  if (step === 'clips' && activeAccount) {
    return (
      <div className="w-80 bg-dark-0 text-white font-sans">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-200">
          <div className="flex items-center gap-2">
            <span>📋</span>
            <span className="font-bold text-sm">Clipord</span>
          </div>
          <div className="flex items-center gap-2">
            {sessionRemaining > 0 && (
              <span className="text-white/20 text-xs">{formatRemaining(sessionRemaining)}</span>
            )}
            <button onClick={handleLock} className="text-white/30 hover:text-white/60 text-xs px-2 py-1 rounded hover:bg-dark-200">
              Lock
            </button>
            <button onClick={openApp} className="text-clipord-400 hover:text-clipord-300 text-xs">
              App →
            </button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {clips.length === 0 ? (
            <div className="py-10 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-white/30 text-xs">No clips yet</p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {clips.map((clip) => {
                const type    = detectClipType(clip.content)
                const preview = generatePreview(clip.content, 60)
                return (
                  <div key={clip.id} className="bg-dark-100 rounded-xl p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <span className="text-sm flex-shrink-0">{getClipTypeIcon(type)}</span>
                      <p className="text-white/70 text-xs leading-relaxed flex-1 break-all line-clamp-3">
                        {preview}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleCopy(clip.content, clip.id)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all
                          ${copied === clip.id
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-clipord-600/20 text-clipord-400 hover:bg-clipord-600/30'}`}
                      >
                        {copied === clip.id ? '✓ Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => handleDelete(clip.id)}
                        className="py-1.5 px-2 rounded-lg text-xs bg-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-dark-200">
          <p className="text-white/20 text-xs truncate">👤 {activeAccount.email}</p>
        </div>
      </div>
    )
  }

  return null
}
