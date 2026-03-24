import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ClipProvider, useClipsSafe } from './context/ClipContext'
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
  storeTOTPSecret,
  retrieveTOTPSecret,
  getOrCreateSalt,
} from '@shared/crypto'
import {
  supabase,
  fetchSaltFromServer,
  saveSaltToServer,
} from '@shared/supabase'
import type { Account, CryptoKeys } from '@shared/types'
import { bridgeAccountToExtension } from '@/main'
import { Spinner } from './components/ui/Spinner'

type AuthStep =
  | 'switcher'
  | 'add-account-email'
  | 'totp-setup'
  | 'totp-verify'
  | 'biometric-verify'
  | 'forgot'
  | 'locked'
  | 'app'
  | 'error'

function IntentHandler() {
  const location    = useLocation()
  const navigate    = useNavigate()
  const clipCtx     = useClipsSafe()
  const handled     = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const params = new URLSearchParams(location.search)
    const intent  = params.get('intent')
    if (intent === 'create-space') {
      const name = params.get('name')
      if (name && clipCtx?.createSpace) {
        handled.current = true
        clipCtx.createSpace(decodeURIComponent(name)).then(() => {
          navigate('/', { replace: true })
        })
      }
    }
  }, [location, navigate, clipCtx])

  return null
}

function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const clipCtx = useClipsSafe()
  const { activeAccount, isVerified } = useAuth()

  useEffect(() => {
    if (!token) return
    const checkInvite = async () => {
      if (!isVerified || !activeAccount) return
      
      const { data, error } = await supabase
        .from('space_invites')
        .select('*, spaces(name)')
        .eq('token', token)
        .single()
        
      if (error || !data) {
        alert('Invalid or expired invite')
        navigate('/', { replace: true })
        return
      }

      const { error: joinError } = await supabase
        .from('space_members')
        .insert({
          space_id: data.space_id,
          account_id: activeAccount.id,
          role: 'member'
        })
        
      if (!joinError) {
        await supabase.from('space_invites').update({ used_at: new Date().toISOString() }).eq('id', data.id)
        if (clipCtx?.refreshClips) await clipCtx.refreshClips()
        alert(`Joined ${data.spaces?.name}!`)
      } else {
        alert(joinError.message)
      }
      navigate('/', { replace: true })
    }
    checkInvite()
  }, [token, activeAccount, isVerified, clipCtx, navigate])

  return (
    <div className="min-h-screen bg-dark-0 flex items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" />
        <p className="text-white/40 text-sm mt-4">Processing invite...</p>
      </div>
    </div>
  )
}

import { useParams } from 'react-router-dom' // Ensure useParams is present

function AppInner() {
  const {
    accounts, activeAccount, deviceSettings,
    isVerified, isLocked,
    setActiveAccount, setVerified, setCryptoKeys, addAccount, saveDeviceSettings
  } = useAuth()

  const [step, setStep]                   = useState<AuthStep>('switcher')
  const [authError, setAuthError]         = useState<string | null>(null)
  const [pendingEmail, setPendingEmail]   = useState('')
  const [pendingUserId, setPendingUserId] = useState('')
  const[cryptoKeyRef, setCryptoKeyRef]   = useState<CryptoKey | null>(null)
  const location                          = useLocation()

  useEffect(() => {
    if (isLocked && step === 'app') setStep('locked')
  },[isLocked, step])

  useEffect(() => {
    if (accounts.length === 0) setStep('switcher')
  }, [accounts])
  
  const unlockAccount = async (account: Account): Promise<CryptoKey> => {
    try {
      const salt = await getOrCreateSalt(
        account.id,
        fetchSaltFromServer,
        saveSaltToServer
      )
      const accountKey = await deriveKeyFromPassphrase(account.id, salt)
      
      const secret = await retrieveTOTPSecret(account.id, accountKey)
      if (secret) {
        bridgeAccountToExtension(account.id, account.email, secret)
      }

      const keys: CryptoKeys = { accountKey, spaceKeys: {} }
      setCryptoKeys(keys)
      setCryptoKeyRef(accountKey)
      setVerified(true)
      
      await saveDeviceSettings({
        lastActiveAt: new Date().toISOString()
      })
      
      return accountKey
    } catch (error) {
        console.error("FATAL: unlockAccount failed:", error)
        setAuthError("A critical error occurred during account decryption. Please try again.")
        setStep('error')
        throw error 
    }
  }

  const handleSelectAccount = async (account: Account) => {
    await setActiveAccount(account)
    const hasTOTP =
      !!localStorage.getItem('clipord_totp_enc_' + account.id) ||
      !!localStorage.getItem('clipord_totp_' + account.id)
    if (!hasTOTP) {
      setStep('add-account-email');
      return
    }

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
    try {
        const account: Account = {
            id: pendingUserId, email: pendingEmail, createdAt: new Date().toISOString(),
        }
        
        addAccount(account)
        await setActiveAccount(account)
        const accountKey = await unlockAccount(account)
        
        // Exclusively save via secure Encrypted Vault wrapper 
        await storeTOTPSecret(account.id, secret, accountKey)
        bridgeAccountToExtension(account.id, account.email, secret)
        
        setStep('app')
    } catch (error) {
        console.error("Failed during TOTP setup finalization:", error)
        setAuthError("Failed to save your security keys after setup. Please try adding the account again.")
        setStep('error')
    }
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

  if (location.pathname === '/reset-password') {
    return <ResetPassword />
  }

  if (step === 'error') {
    return (
        <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-white mb-2">Application Error</h2>
            <p className="text-red-400 text-sm mb-6">{authError || "An unknown error occurred."}</p>
            <button onClick={() => { setAuthError(null); setStep('switcher'); window.location.reload(); }} className="btn-primary px-6 py-2.5">
                Restart
            </button>
        </div>
    )
  }
  
  if (useAuth().isLoading) {
      return (
        <div className="min-h-screen bg-dark-0 flex items-center justify-center">
            <Spinner size="lg" />
        </div>
      )
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
