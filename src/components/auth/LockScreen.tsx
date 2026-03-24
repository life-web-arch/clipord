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
  const { activeAccount, deviceSettings, setCryptoKeys, setVerified } = useAuth()
  const [showForgot, setShowForgot]   = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  if (!activeAccount) return null

  const method: VerificationMethod = deviceSettings?.verificationMethod ?? 'totp'

  const handleVerified = async () => {
    // Re-derive crypto keys on unlock
    const { deriveKeyFromPassphrase, base64ToBuf } = await import('@shared/crypto')
    const saltKey = `clipord_salt_${activeAccount.id}`
    let saltStr   = localStorage.getItem(saltKey)
    if (!saltStr) {
      const { generateSalt, bufToBase64 } = await import('@shared/crypto')
      saltStr = bufToBase64(generateSalt())
      localStorage.setItem(saltKey, saltStr)
    }
    const salt       = base64ToBuf(saltStr)
    const accountKey = await deriveKeyFromPassphrase(activeAccount.id, salt)
    setCryptoKeys({ accountKey, spaceKeys: {} })
    setVerified(true)
    onUnlocked()
  }

  if (showForgot) {
    return (
      <ForgotAccess
        accountId={activeAccount.id}
        email={activeAccount.email}
        onRecovered={handleVerified}
        onBack={() => setShowForgot(false)}
      />
    )
  }

  if ((method === 'biometric' || method === 'both') && !showFallback) {
    return (
      <BiometricVerify
        accountId={activeAccount.id}
        email={activeAccount.email}
        onVerified={handleVerified}
        onFallback={() => setShowFallback(true)}
        onForgot={() => setShowForgot(true)}
      />
    )
  }

  return (
    <TOTPVerify
      accountId={activeAccount.id}
      email={activeAccount.email}
      cryptoKey={null}
      onVerified={handleVerified}
      onForgot={() => setShowForgot(true)}
    />
  )
}
