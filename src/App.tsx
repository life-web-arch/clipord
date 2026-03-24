import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ClipProvider } from './context/ClipContext'
import { AccountSwitcher } from './components/auth/AccountSwitcher'
import { EmailOTP } from './components/auth/EmailOTP'
import { TOTPSetup } from './components/auth/TOTPSetup'
import { TOTPVerify } from './components/auth/TOTPVerify'
import { BiometricVerify } from './components/auth/BiometricVerify'
import { ForgotAccess } from './components/auth/ForgotAccess'
import { LockScreen } from './components/auth/LockScreen'
import { MainApp } from './pages/MainApp'
import { ResetPassword } from './pages/ResetPassword'
import {
  deriveKeyFromPassphrase,
  generateSalt,
  bufToBase64,
  base64ToBuf,
  storeTOTPSecret,
  getOrCreateSalt,
} from '@shared/crypto'
import { upsertDeviceSettings } from '@shared/db'
import { getDeviceId } from '@shared/platform'
import {
  supabase,
  fetchSaltFromServer,
  saveSaltToServer,
} from '@shared/supabase'
import type { Account, CryptoKeys } from '@shared/types'

type AuthStep =
  | 'switcher'
  | 'add-account-email'
  | 'totp-setup'
  | 'totp-verify'
  | 'biometric-verify'
  | 'forgot'
  | 'locked'
  | 'app'

// ---- Intent handler — scrubs URL after processing ----
function IntentHandler() {
  const location    = useLocation()
  const navigate    = useNavigate()
  const { createSpace } = useClipsOrNull()
  const handled     = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const params = new URLSearchParams(location.search)
    const intent  = params.get('intent')
    if (intent === 'create-space') {
      const name = params.get('name')
      if (name && createSpace) {
        handled.current = true
        createSpace(decodeURIComponent(name)).then(() => {
          // Scrub URL to prevent re-trigger on refresh
          navigate('/', { replace: true })
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

// Safe hook that returns null if outside ClipProvider
function useClipsOrNull() {
  try {
    const { createSpace } = require('./context/ClipContext').useClips()
    return { createSpace }
  } catch {
    return { createSpace: null }
  }
}

// ---- Invite accept page ----
function InviteAccept() {
  const { isVerified, activeAccount } = useAuth()
  const navigate                      = useNavigate()
  const location                      = useLocation()
  const token                         = location.pathname.split('/invite/')[1] ?? ''
  const [status, setStatus]           = useState<'pending' | 'accepted' | 'error'>('pending')

  useEffect(() => {
    if (!isVerified || !activeAccount || !token) {
      if (!isVerified) setStatus('error')
      return
    }
    const accept = async () => {
      try {
        const { data: invite, error: inviteErr } = await supabase
          .from('space_invites')
          .select('*')
          .eq('token', token)
          .single()

        if (inviteErr || !invite) { setStatus('error'); return }
        if (invite.used_at)       { setStatus('error'); return }
        if (new Date(invite.expires_at) < new Date()) { setStatus('error'); return }

        // Mark invite as used
        await supabase
          .from('space_invites')
          .update({ used_at: new Date().toISOString() })
          .eq('id', invite.id)

        // Add the ACCEPTING user — not the creator
        const { error: memberErr } = await supabase
          .from('space_members')
          .insert({
            space_id:            invite.space_id,
            account_id:          activeAccount.id,  // ← fixed: the person accepting
            role:                'member',
            encrypted_space_key: '',
            iv:                  '',
          })

        if (memberErr && !memberErr.message.includes('duplicate')) {
          setStatus('error')
          return
        }

        setStatus('accepted')
      } catch {
        setStatus('error')
      }
    }
    accept()
  }, [token, isVerified, activeAccount])

  return (
    <div className="min-h-screen bg-dark-0 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        {status === 'pending' && (
          <>
            <div className="text-4xl mb-4">🔗</div>
            <p className="text-white/60">Processing invite…</p>
          </>
        )}
        {status === 'accepted' && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <p className="text-white font-semibold mb-2">Invite accepted!</p>
            <p className="text-white/40 text-sm mb-6">
              The space creator will share the encryption key with you.
              You'll see the space once approved.
            </p>
            <button onClick={() => navigate('/')} className="btn-primary px-6 py-2.5">
              Go to app
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-4xl mb-4">❌</div>
            <p className="text-white font-semibold mb-2">Invalid or expired invite</p>
            <p className="text-white/40 text-sm mb-6">
              This link may have already been used or has expired.
            </p>
            <button onClick={() => navigate('/')} className="btn-primary px-6 py-2.5">
              Go to app
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---- Main auth state machine ----
function AppInner() {
  const {
    accounts, activeAccount, deviceSettings,
    isVerified, isLocked,
    setActiveAccount, setVerified, setCryptoKeys, addAccount,
  } = useAuth()

  const [step, setStep]                   = useState<AuthStep>('switcher')
  const [pendingEmail, setPendingEmail]   = useState('')
  const [pendingUserId, setPendingUserId] = useState('')
  const [cryptoKeyRef, setCryptoKeyRef]   = useState<CryptoKey | null>(null)
  const location                          = useLocation()

  useEffect(() => {
    if (isLocked && step === 'app') setStep('locked')
  }, [isLocked, step])

  useEffect(() => {
    if (accounts.length === 0) setStep('switcher')
  }, [accounts])

  /**
   * Derive the account encryption key using a salt that is synced across devices
   * via Supabase user metadata. This ensures the SAME key is produced on every device.
   */
  const unlockAccount = async (account: Account): Promise<CryptoKey> => {
    const salt = await getOrCreateSalt(
      account.id,
      fetchSaltFromServer,
      saveSaltToServer
    )
    const accountKey = await deriveKeyFromPassphrase(account.id, salt)
    const keys: CryptoKeys = { accountKey, spaceKeys: {} }
    setCryptoKeys(keys)
    setCryptoKeyRef(accountKey)
    setVerified(true)
    const deviceId = getDeviceId()
    await upsertDeviceSettings({
      accountId:           account.id,
      deviceId,
      verificationEnabled: deviceSettings?.verificationEnabled ?? true,
      verificationMethod:  deviceSettings?.verificationMethod  ?? 'totp',
      cacheWipeAfterDays:  deviceSettings?.cacheWipeAfterDays  ?? null,
      lastActiveAt:        new Date().toISOString(),
    })
    return accountKey
  }

  const handleSelectAccount = async (account: Account) => {
    await setActiveAccount(account)
    const hasTOTP =
      !!localStorage.getItem('clipord_totp_enc_' + account.id) ||
      !!localStorage.getItem('clipord_totp_' + account.id)
    if (!hasTOTP) { setStep('add-account-email'); return }

    if (deviceSettings?.verificationEnabled === false) {
      await unlockAccount(account)
      setStep('app')
      return
    }
    const method = deviceSettings?.verificationMethod ?? 'totp'
    if (method === 'biometric' || method === 'both') {
      setStep('biometric-verify')
    } else {
      setStep('totp-verify')
    }
  }

  const handleEmailVerified = (email: string, userId: string) => {
    setPendingEmail(email)
    setPendingUserId(userId)
    setStep('totp-setup')
  }

  const handleTOTPSetupComplete = async (secret: string) => {
    const account: Account = {
      id: pendingUserId, email: pendingEmail, createdAt: new Date().toISOString(),
    }
    addAccount(account)
    await setActiveAccount(account)
    const accountKey = await unlockAccount(account)
    await storeTOTPSecret(account.id, secret, accountKey)
    // Also save plaintext for extension bridge (stored separately)
    localStorage.setItem('clipord_totp_' + account.id, secret)
    setStep('app')
  }

  const handleTOTPVerified = async () => {
    if (!activeAccount) return
    await unlockAccount(activeAccount)
    setStep('app')
  }

  const handleBiometricVerified = async () => {
    if (!activeAccount) return
    await unlockAccount(activeAccount)
    setStep('app')
  }

  // Always show reset password page regardless of auth
  if (location.pathname === '/reset-password') {
    return <ResetPassword />
  }

  if (step === 'locked') {
    return <LockScreen onUnlocked={() => setStep('app')} />
  }

  if (step === 'app' && isVerified) {
    return (
      <ClipProvider>
        <IntentHandler />
        <Routes>
          <Route path="/*"                element={<MainApp />} />
          <Route path="/invite/:token"    element={<InviteAccept />} />
          <Route path="/reset-password"   element={<ResetPassword />} />
        </Routes>
      </ClipProvider>
    )
  }

  if (step === 'switcher') {
    return (
      <AccountSwitcher
        onSelectAccount={handleSelectAccount}
        onAddAccount={() => setStep('add-account-email')}
      />
    )
  }

  if (step === 'add-account-email') {
    return <EmailOTP onVerified={handleEmailVerified} onBack={() => setStep('switcher')} />
  }

  if (step === 'totp-setup' && pendingEmail && pendingUserId) {
    return (
      <TOTPSetup
        email={pendingEmail}
        accountId={pendingUserId}
        onComplete={handleTOTPSetupComplete}
      />
    )
  }

  if (step === 'totp-verify' && activeAccount) {
    return (
      <TOTPVerify
        accountId={activeAccount.id}
        email={activeAccount.email}
        cryptoKey={cryptoKeyRef}
        onVerified={handleTOTPVerified}
        onForgot={() => setStep('forgot')}
      />
    )
  }

  if (step === 'biometric-verify' && activeAccount) {
    return (
      <BiometricVerify
        accountId={activeAccount.id}
        email={activeAccount.email}
        onVerified={handleBiometricVerified}
        onFallback={() => setStep('totp-verify')}
        onForgot={() => setStep('forgot')}
      />
    )
  }

  if (step === 'forgot' && activeAccount) {
    return (
      <ForgotAccess
        accountId={activeAccount.id}
        email={activeAccount.email}
        cryptoKey={cryptoKeyRef}
        onRecovered={handleTOTPVerified}
        onBack={() => setStep(
          deviceSettings?.verificationMethod === 'biometric' ? 'biometric-verify' : 'totp-verify'
        )}
      />
    )
  }

  return null
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/*"              element={<AppInner />} />
      </Routes>
    </AuthProvider>
  )
}
