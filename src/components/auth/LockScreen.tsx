import { useState } from 'react'
import { TOTPVerify } from './TOTPVerify'
import { BiometricVerify } from './BiometricVerify'
import { ForgotAccess } from './ForgotAccess'
import { useAuth } from '../../context/AuthContext'
import type { VerificationMethod } from '@shared/types'

interface Props {
  onUnlocked: () => void
}

export function LockScreen({ onUnlocked }: Props) {
  const { activeAccount, deviceSettings, setCryptoKeys, setVerified, saveDeviceSettings } = useAuth()
  const[showForgot, setShowForgot]     = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  if (!activeAccount) return null

  const method: VerificationMethod = deviceSettings?.verificationMethod ?? 'totp'

  const handleVerified = async () => {
    try {
      const { importVaultKey, retrieveTOTPSecret } = await import('@shared/crypto')
      const { bridgeAccountToExtension } = await import('@/main')
      const { supabase } = await import('@shared/supabase')
      
      const b64 = localStorage.getItem('clipord_vault_key_' + activeAccount.id)
      if (!b64) throw new Error("Vault Key missing locally")
      const accountKey = await importVaultKey(b64)
      
      const secret = await retrieveTOTPSecret(activeAccount.id, accountKey)
      const { data } = await supabase.auth.getSession()

      if (secret && data.session) {
        bridgeAccountToExtension(activeAccount.id, activeAccount.email, secret, b64, data.session.access_token)
      }

      setCryptoKeys({ accountKey, spaceKeys: {} })
      setVerified(true)
      await saveDeviceSettings({ lastActiveAt: new Date().toISOString() })
      onUnlocked()
    } catch (error) {
        console.error("Verification process failed:", error)
        setShowForgot(true)
    }
  }

  if (showForgot) {
    return <ForgotAccess accountId={activeAccount.id} email={activeAccount.email} cryptoKey={null} onRecovered={handleVerified} onBack={() => setShowForgot(false)} />
  }

  if ((method === 'biometric' || method === 'both') && !showFallback) {
    return <BiometricVerify accountId={activeAccount.id} email={activeAccount.email} onVerified={handleVerified} onFallback={() => setShowFallback(true)} onForgot={() => setShowForgot(true)} />
  }

  return <TOTPVerify accountId={activeAccount.id} email={activeAccount.email} cryptoKey={null} onVerified={handleVerified} onForgot={() => setShowForgot(true)} />
}
