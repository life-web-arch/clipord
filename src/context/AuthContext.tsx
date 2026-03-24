import React, {
  createContext, useContext, useEffect, useState,
  useCallback, useRef
} from 'react'
import { getDeviceId } from '@shared/platform'
import { db, getDeviceSettings, upsertDeviceSettings } from '@shared/db'
import type { Account, DeviceSettings, CryptoKeys } from '@shared/types'

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

interface AuthContextValue {
  accounts:         Account[]
  activeAccount:    Account | null
  deviceSettings:   DeviceSettings | null
  cryptoKeys:       CryptoKeys | null
  isVerified:       boolean
  isLoading:        boolean
  isLocked:         boolean
  setActiveAccount: (account: Account) => Promise<void>
  setVerified:      (verified: boolean) => void
  setCryptoKeys:    (keys: CryptoKeys) => void
  addAccount:       (account: Account) => void
  removeAccount:    (accountId: string) => Promise<void>
  refreshSettings:  () => Promise<void>
  lockApp:          () => void
  resetInactivity:  () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]               = useState<Account[]>([])
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null)
  const [deviceSettings, setDeviceSettings]   = useState<DeviceSettings | null>(null)
  const [cryptoKeys, setCryptoKeysState]       = useState<CryptoKeys | null>(null)
  const [isVerified, setIsVerified]           = useState(false)
  const [isLocked, setIsLocked]               = useState(false)
  const [isLoading, setIsLoading]             = useState(true)
  const inactivityTimer                        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cryptoKeysRef                          = useRef<CryptoKeys | null>(null)

  // Load accounts from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('clipord_accounts')
    if (stored) {
      try { setAccounts(JSON.parse(stored)) } catch { setAccounts([]) }
    }
    setIsLoading(false)
  }, [])

  // Auto-lock on visibility change (app backgrounded)
  useEffect(() => {
    if (!isVerified) return
    const handleVisibility = () => {
      if (document.hidden) {
        // Blur content immediately so app switcher can't capture it
        document.body.style.filter = 'blur(20px)'
        document.body.style.pointerEvents = 'none'
      } else {
        document.body.style.filter = ''
        document.body.style.pointerEvents = ''
        // If was hidden for too long, lock
        // (handled by inactivity timer below)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isVerified])

  // Inactivity timer
  const resetInactivity = useCallback(() => {
    if (!isVerified) return
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => {
      lockApp()
    }, INACTIVITY_TIMEOUT_MS)
  }, [isVerified])

  // Track user activity
  useEffect(() => {
    if (!isVerified) return
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll']
    const handler = () => resetInactivity()
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    resetInactivity()
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [isVerified, resetInactivity])

  const lockApp = useCallback(() => {
    setIsVerified(false)
    setIsLocked(true)
    // Wipe crypto keys from memory
    cryptoKeysRef.current = null
    setCryptoKeysState(null)
    document.body.style.filter      = ''
    document.body.style.pointerEvents = ''
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }, [])

  const setCryptoKeys = useCallback((keys: CryptoKeys) => {
    cryptoKeysRef.current = keys
    setCryptoKeysState(keys)
  }, [])

  const setVerified = useCallback((verified: boolean) => {
    setIsVerified(verified)
    if (verified) {
      setIsLocked(false)
      resetInactivity()
    }
  }, [resetInactivity])

  const setActiveAccount = useCallback(async (account: Account) => {
    setActiveAccountState(account)
    setIsVerified(false)
    setIsLocked(false)
    setCryptoKeysState(null)
    cryptoKeysRef.current = null
    const deviceId = getDeviceId()
    const settings = await getDeviceSettings(account.id, deviceId)
    setDeviceSettings(settings ?? null)
  }, [])

  const addAccount = useCallback((account: Account) => {
    setAccounts((prev) => {
      const updated = [...prev.filter((a) => a.id !== account.id), account]
      localStorage.setItem('clipord_accounts', JSON.stringify(updated))
      return updated
    })
  }, [])

  const removeAccount = useCallback(async (accountId: string) => {
    // Wipe all local data for this account
    await db.clips.where({ accountId }).delete()
    await db.deviceSettings.where({ accountId }).delete()
    await db.pendingClips.where({ accountId }).delete()
    // Wipe TOTP secrets
    localStorage.removeItem(`clipord_totp_${accountId}`)
    localStorage.removeItem(`clipord_totp_enc_${accountId}`)
    localStorage.removeItem(`clipord_salt_${accountId}`)
    localStorage.removeItem(`clipord_bf_${accountId}`)
    setAccounts((prev) => {
      const updated = prev.filter((a) => a.id !== accountId)
      localStorage.setItem('clipord_accounts', JSON.stringify(updated))
      return updated
    })
    if (activeAccount?.id === accountId) {
      setActiveAccountState(null)
      setIsVerified(false)
      setCryptoKeysState(null)
      cryptoKeysRef.current = null
    }
  }, [activeAccount])

  const refreshSettings = useCallback(async () => {
    if (!activeAccount) return
    const deviceId = getDeviceId()
    const settings = await getDeviceSettings(activeAccount.id, deviceId)
    setDeviceSettings(settings ?? null)
  }, [activeAccount])

  return (
    <AuthContext.Provider value={{
      accounts,
      activeAccount,
      deviceSettings,
      cryptoKeys,
      isVerified,
      isLoading,
      isLocked,
      setActiveAccount,
      setVerified,
      setCryptoKeys,
      addAccount,
      removeAccount,
      refreshSettings,
      lockApp,
      resetInactivity,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
