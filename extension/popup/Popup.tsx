import { useState, useEffect, useCallback } from 'react'
import * as OTPAuth from 'otpauth'
import {
  isSessionValid,
  setSession,
  clearSession,
  getRemainingMs,
  isLockedOut,
  recordFailedAttempt,
  clearBruteForce,
  refreshSession,
} from '../lib/session'
import {
  getExtAccounts,
} from '../lib/authBridge'
import {
  loadClipsEncrypted,
  deleteClipEncrypted,
} from '../lib/extensionCrypto'
import type { StoredClip } from '../lib/extensionCrypto'
import type { ExtAccountRecord } from '@shared/types'
import { detectClipType, getClipTypeIcon, generatePreview } from '@shared/detector'

type PopupStep = 'account-select' | 'verify' | 'clips'

export function Popup() {
  const [step, setStep]                   = useState<PopupStep>('account-select')
  const [accounts, setAccounts]           = useState<ExtAccountRecord[]>([])
  const[activeAccount, setActiveAccount] = useState<ExtAccountRecord | null>(null)
  const [clips, setClips]                 = useState<StoredClip[]>([])
  const [code, setCode]                   = useState('')
  const [error, setError]                 = useState<string | null>(null)
  const [loading, setLoading]             = useState(false)
  const [copied, setCopied]               = useState<string | null>(null)
  const [remainingMs, setRemainingMs]     = useState(0)
  const [attemptsLeft, setAttemptsLeft]   = useState(5)
  const[lockoutMs, setLockoutMs]         = useState(0)
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  useEffect(() => {
    getExtAccounts().then((accs) => {
      setAccounts(accs)
      setLoadingAccounts(false)
    })
  },[])

  useEffect(() => {
    if (step !== 'clips') return
    const interval = setInterval(async () => {
      const remaining = await getRemainingMs()
      setRemainingMs(remaining)
      if (remaining <= 0 && activeAccount) {
        const valid = await isSessionValid(activeAccount.id)
        if (!valid) {
          setStep('account-select')
          setClips([])
        }
      }
    }, 10_000)
    return () => clearInterval(interval)
  },[step, activeAccount])

  useEffect(() => {
    if (lockoutMs <= 0) return
    const interval = setInterval(() => {
      setLockoutMs((prev) => {
        const next = prev - 1000
        if (next <= 0) { setError(null); return 0 }
        setError('Locked. Try again in ' + Math.ceil(next / 60000) + 'm.')
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [lockoutMs])

  const handleSelectAccount = useCallback(async (account: ExtAccountRecord) => {
    setActiveAccount(account)
    setError(null)
    setCode('')

    const valid = await isSessionValid(account.id)
    if (valid) {
      const loaded = await loadClipsEncrypted(account.id)
      setClips([...loaded].reverse())
      const remaining = await getRemainingMs()
      setRemainingMs(remaining)
      setStep('clips')
      return
    }

    const lockCheck = await isLockedOut(account.id)
    if (lockCheck.locked) {
      setLockoutMs(lockCheck.remainingMs)
      setError('Locked. Try again in ' + Math.ceil(lockCheck.remainingMs / 60000) + 'm.')
    }

    setStep('verify')
  },[])

  const handleVerify = useCallback(async () => {
    if (!activeAccount || !code || code.length < 6) return

    const lockCheck = await isLockedOut(activeAccount.id)
    if (lockCheck.locked) return

    setLoading(true)
    setError(null)

    try {
      const secret = activeAccount.totpSecret
      if (!secret) {
        setError('Authenticator not configured. Sign in via the Clipord web app first.')
        setLoading(false)
        return
      }

      const totp = new OTPAuth.TOTP({
        issuer:    'Clipord',
        label:     activeAccount.email,
        algorithm: 'SHA1',
        digits:    6,
        period:    30,
        secret:    OTPAuth.Secret.fromBase32(secret),
      })

      const delta = totp.validate({ token: code, window: 1 })

      if (delta === null) {
        const result = await recordFailedAttempt(activeAccount.id)
        if (result.lockedOut) {
          const ms = result.lockedUntilMs! - Date.now()
          setLockoutMs(ms)
          setError('Too many attempts. Locked for 15 minutes.')
        } else {
          setAttemptsLeft(result.attemptsLeft)
          setError('Incorrect code. ' + result.attemptsLeft + ' attempt' + (result.attemptsLeft !== 1 ? 's' : '') + ' left.')
        }
      } else {
        await clearBruteForce(activeAccount.id)
        await setSession(activeAccount.id)
        const loaded = await loadClipsEncrypted(activeAccount.id)
        setClips([...loaded].reverse())
        const remaining = await getRemainingMs()
        setRemainingMs(remaining)
        setStep('clips')
      }
    } catch (e) {
      setError('Verification error. Please try again.')
    }

    setCode('')
    setLoading(false)
  }, [activeAccount, code])

  const handleCopy = useCallback(async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopied(id)
    if (activeAccount) {
      await refreshSession(activeAccount.id)
      const remaining = await getRemainingMs()
      setRemainingMs(remaining)
    }
    setTimeout(() => setCopied(null), 2000)
  }, [activeAccount])

  const handleDelete = useCallback(async (id: string) => {
    if (!activeAccount) return
    await deleteClipEncrypted(activeAccount.id, id)
    setClips((prev) => prev.filter((c) => c.id !== id))
  }, [activeAccount])

  const handleLock = useCallback(async () => {
    await clearSession()
    setClips([])
    setStep('account-select')
    setCode('')
    setError(null)
    setActiveAccount(null)
  },[])

  const openApp = () => {
    chrome.tabs.create({ url: 'https://clipord.app' })
  }

  const formatTime = (ms: number) => {
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return m + ':' + String(s).padStart(2, '0')
  }

  if (loadingAccounts) {
    return (
      <div className="w-72 bg-dark-0 text-white p-6 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-clipord-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (step === 'account-select') {
    return (
      <div className="w-72 bg-dark-0 text-white font-sans" style={{ minHeight: '200px' }}>
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
              <p className="text-white/30 text-xs mb-3">No accounts found.</p>
              <p className="text-white/20 text-xs mb-4">Sign in via the Clipord web app first.</p>
              <button
                onClick={openApp}
                className="bg-clipord-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-clipord-500"
              >
                Open Clipord
              </button>
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
                  <p className="text-white/30 text-xs">Tap to verify</p>
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
      <div className="w-72 bg-dark-0 text-white font-sans">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-200">
          <button
            onClick={() => { setStep('account-select'); setError(null); setActiveAccount(null) }}
            className="text-white/40 hover:text-white/60 text-sm"
          >
            ←
          </button>
          <span className="text-sm font-medium flex-1 truncate">{activeAccount.email}</span>
        </div>
        <div className="p-4">
          <div className="text-center mb-4">
            <div className="text-3xl mb-2">{locked ? '🔒' : '🔑'}</div>
            <p className="text-white/40 text-xs">Enter authenticator code</p>
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
                className="w-full bg-dark-100 border border-dark-300 rounded-xl px-4 py-3 text-white text-center text-xl tracking-[0.4em] font-mono focus:outline-none focus:border-clipord-500 mb-3"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
              />
              <button
                onClick={handleVerify}
                disabled={loading || code.length < 6}
                className="w-full bg-clipord-600 hover:bg-clipord-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify'}
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
      <div className="w-72 bg-dark-0 text-white font-sans">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-200">
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="font-bold text-sm">Clipord</span>
          </div>
          <div className="flex items-center gap-2">
            {remainingMs > 0 && (
              <span className="text-white/20 text-xs" title="Session expires in">{formatTime(remainingMs)}</span>
            )}
            <button
              onClick={handleLock}
              className="text-white/30 hover:text-white/60 text-xs px-2 py-1 rounded hover:bg-dark-200"
            >
              Lock
            </button>
            <button onClick={openApp} className="text-clipord-400 text-xs hover:text-clipord-300">
              App →
            </button>
          </div>
        </div>

        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {clips.length === 0 ? (
            <div className="py-10 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-white/30 text-xs">No clips yet</p>
              <p className="text-white/20 text-xs mt-1">Copy something and save it via the toast</p>
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
                      <p className="text-white/70 text-xs leading-relaxed flex-1 break-all"
                         style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {preview}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleCopy(clip.content, clip.id)}
                        className={'flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ' +
                          (copied === clip.id
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-clipord-600/20 text-clipord-400 hover:bg-clipord-600/30')}
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
