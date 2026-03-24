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
  // Use a ref for lockApp so resetInactivity can reference it without stale closure
  const lockAppRef = useRef<() => void>(() => {/* noop until mounted */})

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
        document.body.style.filter        = 'blur(20px)'
        document.body.style.pointerEvents = 'none'
      } else {
        document.body.style.filter        = ''
        document.body.style.pointerEvents = ''
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isVerified])

  // lockApp — defined before resetInactivity so the ref is always up to date
  const lockApp = useCallback(() => {
    setIsVerified(false)
    setIsLocked(true)
    cryptoKeysRef.current = null
    setCryptoKeysState(null)
    document.body.style.filter        = ''
    document.body.style.pointerEvents = ''
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current)
      inactivityTimer.current = null
    }
  }, [])

  // Keep the ref in sync so resetInactivity's closure always calls the latest lockApp
  useEffect(() => {
    lockAppRef.current = lockApp
  }, [lockApp])

  // Inactivity timer — uses ref to avoid stale lockApp closure
  const resetInactivity = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => {
      lockAppRef.current()
    }, INACTIVITY_TIMEOUT_MS)
  }, [])

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
    await db.clips.where('accountId').equals(accountId).delete()
    await db.deviceSettings.where('accountId').equals(accountId).delete()
    await db.pendingClips.where('accountId').equals(accountId).delete()
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

  // Persist device settings whenever verificationEnabled/method changes
  const saveDeviceSettings = useCallback(async (patch: Partial<DeviceSettings>) => {
    if (!activeAccount) return
    const deviceId = getDeviceId()
    const existing = await getDeviceSettings(activeAccount.id, deviceId)
    const merged: DeviceSettings = {
      accountId:           activeAccount.id,
      deviceId,
      verificationEnabled: true,
      verificationMethod:  'totp',
      cacheWipeAfterDays:  null,
      lastActiveAt:        new Date().toISOString(),
      ...existing,
      ...patch,
    }
    await upsertDeviceSettings(merged)
    setDeviceSettings(merged)
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
      // @ts-expect-error — exposed for Settings page
      saveDeviceSettings,
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

// Extended hook for Settings page that also exposes saveDeviceSettings
export function useAuthExtended(): AuthContextValue & {
  saveDeviceSettings: (patch: Partial<DeviceSettings>) => Promise<void>
} {
  return useAuth() as AuthContextValue & {
    saveDeviceSettings: (patch: Partial<DeviceSettings>) => Promise<void>
  }
}
