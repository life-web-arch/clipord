import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ClipProvider } from './context/ClipContext'
import { AccountSwitcher } from './components/auth/AccountSwitcher'
import { EmailOTP } from './components/auth/EmailOTP'
import { TOTPSetup } from './components/auth/TOTPSetup'
import { TOTPVerify } from './components/auth/TOTPVerify'
import { BiometricVerify } from './components/auth/BiometricVerify'
import { ForgotAccess } from './components/auth/ForgotAccess'
import { MainApp } from './pages/MainApp'
import { deriveKeyFromPassphrase, generateSalt, bufToBase64, base64ToBuf } from '@shared/crypto'
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
  | 'app'

function AppInner() {
  const { accounts, activeAccount, deviceSettings, isVerified,
          setActiveAccount, setVerified, setCryptoKeys, addAccount } = useAuth()
  const [step, setStep]             = useState<AuthStep>('switcher')
  const [pendingEmail, setPendingEmail] = useState('')
  const [pendingUserId, setPendingUserId] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (accounts.length === 0) setStep('switcher')
  }, [accounts])

  useEffect(() => {
    if (isVerified) setStep('app')
  }, [isVerified])

  const handleSelectAccount = async (account: Account) => {
    await setActiveAccount(account)
    const hasTOTP = !!localStorage.getItem(`clipord_totp_${account.id}`)
    if (!hasTOTP) {
      setStep('add-account-email')
      return
    }
    if (deviceSettings?.verificationEnabled === false) {
      await unlockAccount(account)
      return
    }
    const method = deviceSettings?.verificationMethod ?? 'totp'
    if (method === 'biometric' || method === 'both') {
      setStep('biometric-verify')
    } else {
      setStep('totp-verify')
    }
  }

  const unlockAccount = async (account: Account) => {
    const saltKey  = `clipord_salt_${account.id}`
    let saltStr    = localStorage.getItem(saltKey)
    if (!saltStr) {
      const { generateSalt, bufToBase64 } = await import('@shared/crypto')
      saltStr = bufToBase64(generateSalt())
      localStorage.setItem(saltKey, saltStr)
    }
    const { base64ToBuf, deriveKeyFromPassphrase } = await import('@shared/crypto')
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
  }

  const handleEmailVerified = (email: string, userId: string) => {
    setPendingEmail(email)
    setPendingUserId(userId)
    setStep('totp-setup')
  }

  const handleTOTPSetupComplete = async (secret: string) => {
    const account: Account = {
      id:        pendingUserId,
      email:     pendingEmail,
      createdAt: new Date().toISOString(),
    }
    addAccount(account)
    await setActiveAccount(account)
    await unlockAccount(account)
  }

  const handleTOTPVerified = async () => {
    if (!activeAccount) return
    await unlockAccount(activeAccount)
  }

  const handleBiometricVerified = async () => {
    if (!activeAccount) return
    await unlockAccount(activeAccount)
  }

  if (step === 'app' && isVerified) {
    return (
      <ClipProvider>
        <Routes>
          <Route path="/*" element={<MainApp />} />
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
        onBack={() => setStep(deviceSettings?.verificationMethod === 'biometric' ? 'biometric-verify' : 'totp-verify')}
      />
    )
  }

  return null
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
