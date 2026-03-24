import { useState, useEffect } from 'react'
import { Routes, Route, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ClipProvider, useClips } from './context/ClipContext'
import { AccountSwitcher } from './components/auth/AccountSwitcher'
import { EmailOTP } from './components/auth/EmailOTP'
import { TOTPSetup } from './components/auth/TOTPSetup'
import { TOTPVerify } from './components/auth/TOTPVerify'
import { BiometricVerify } from './components/auth/BiometricVerify'
import { ForgotAccess } from './components/auth/ForgotAccess'
import { LockScreen } from './components/auth/LockScreen'
import { MainApp } from './pages/MainApp'
import {
  deriveKeyFromPassphrase, generateSalt,
  bufToBase64, base64ToBuf, storeTOTPSecret
} from '@shared/crypto'
import { upsertDeviceSettings } from '@shared/db'
import { getDeviceId } from '@shared/platform'
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

// ---- Inner app shell — handles auth state machine ----
function AppInner() {
  const {
    accounts, activeAccount, deviceSettings,
    isVerified, isLocked,
    setActiveAccount, setVerified, setCryptoKeys, addAccount
  } = useAuth()

  const [step, setStep]                   = useState<AuthStep>('switcher')
  const [pendingEmail, setPendingEmail]   = useState('')
  const [pendingUserId, setPendingUserId] = useState('')
  const [pendingKey, setPendingKey]       = useState<CryptoKey | null>(null)
  const [searchParams, setSearchParams]   = useSearchParams()

  // React to lock state
  useEffect(() => {
    if (isLocked && step === 'app') setStep('locked')
  }, [isLocked, step])

  useEffect(() => {
    if (accounts.length === 0) setStep('switcher')
  }, [accounts])

  const unlockAccount = async (account: Account): Promise<CryptoKey> => {
    const saltKey = `clipord_salt_${account.id}`
    let saltStr   = localStorage.getItem(saltKey)
    if (!saltStr) {
      saltStr = bufToBase64(generateSalt())
      localStorage.setItem(saltKey, saltStr)
    }
    const salt       = base64ToBuf(saltStr)
    const accountKey = await deriveKeyFromPassphrase(account.id, salt)
    const keys: CryptoKeys = { accountKey, spaceKeys: {} }
    setCryptoKeys(keys)
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
    const hasTOTP = !!localStorage.getItem(`clipord_totp_enc_${account.id}`) ||
                    !!localStorage.getItem(`clipord_totp_${account.id}`)
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
    // Write encrypted copy (main app) — plaintext copy already written in TOTPSetup.tsx
    await storeTOTPSecret(account.id, secret, accountKey)
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

  const handleLockScreenUnlocked = () => setStep('app')

  // ---- Handle ?intent=create-space once the app is running ----
  // The browser extension opens `https://clipord.app/?intent=create-space&name=…`
  // We pick this up after the user is verified and forward it to ClipContext.
  function IntentHandler() {
    const { createSpace } = useClips()
    useEffect(() => {
      const intent = searchParams.get('intent')
      const name   = searchParams.get('name')
      if (intent === 'create-space' && name) {
        createSpace(name).catch(console.error)
        // Clear the params so it doesn't re-trigger
        setSearchParams({})
      }
    }, [createSpace])
    return null
  }

  // ---- Render ----

  if (step === 'locked') {
    return <LockScreen onUnlocked={handleLockScreenUnlocked} />
  }

  if (step === 'app' && isVerified) {
    return (
      <ClipProvider>
        <IntentHandler />
        <Routes>
          <Route path="/*" element={<MainApp />} />
          <Route
            path="/invite/:token"
            element={<InviteAccept />}
          />
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
    return (
      <EmailOTP
        onVerified={handleEmailVerified}
        onBack={() => setStep('switcher')}
      />
    )
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
        cryptoKey={pendingKey}
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
        onRecovered={handleTOTPVerified}
        onBack={() => setStep(
          deviceSettings?.verificationMethod === 'biometric' ? 'biometric-verify' : 'totp-verify'
        )}
      />
    )
  }

  return null
}

// ---- Invite accept page ----
// Minimal placeholder; full implementation requires server-side token verification.
function InviteAccept() {
  const { activeAccount, isVerified } = useAuth()
  const [status, setStatus] = useState<'pending' | 'accepted' | 'error'>('pending')
  const [searchParams] = useSearchParams()

  // Extract token from path
  const token = window.location.pathname.split('/invite/')[1]

  useEffect(() => {
    if (!token || !isVerified || !activeAccount) return

    async function accept() {
      try {
        const { supabase } = await import('@shared/supabase')
        // Find the invite
        const { data: invite, error: inviteErr } = await supabase
          .from('space_invites')
          .select('*')
          .eq('token', token)
          .single()

        if (inviteErr || !invite) { setStatus('error'); return }
        if (invite.used_at) { setStatus('error'); return }
        if (new Date(invite.expires_at) < new Date()) { setStatus('error'); return }

        // Mark invite used
        await supabase
          .from('space_invites')
          .update({ used_at: new Date().toISOString() })
          .eq('id', invite.id)

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
              The space creator will approve your request. You'll see the space once approved.
            </p>
            <a href="/" className="btn-primary px-6 py-2.5 inline-block">Go to app</a>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-4xl mb-4">❌</div>
            <p className="text-white font-semibold mb-2">Invalid or expired invite</p>
            <p className="text-white/40 text-sm mb-6">This link may have already been used or has expired.</p>
            <a href="/" className="btn-primary px-6 py-2.5 inline-block">Go to app</a>
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
