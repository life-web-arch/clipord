import React, {
  createContext, useContext, useEffect, useState,
  useCallback, useRef
} from 'react'
import { getDeviceId } from '@shared/platform'
import { db, getDeviceSettings, upsertDeviceSettings, wipeAccountCache } from '@shared/db'
import { supabase } from '@shared/supabase'
import type { Account, DeviceSettings, CryptoKeys, VerificationMethod } from '@shared/types'

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000

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
  saveDeviceSettings: (settings: Partial<DeviceSettings>, explicitAccountId?: string) => Promise<void>
  lockApp:          () => void
  resetInactivity:  () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const[accounts, setAccounts]                = useState<Account[]>([])
  const [activeAccountState, setActiveAccountState] = useState<Account | null>(null)
  const[deviceSettings, setDeviceSettings]    = useState<DeviceSettings | null>(null)
  const[cryptoKeys, setCryptoKeysState]        = useState<CryptoKeys | null>(null)
  const[isVerified, setIsVerified]            = useState(false)
  const[isLocked, setIsLocked]                = useState(false)
  const [isLoading, setIsLoading]              = useState(true)
  const inactivityTimer                         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cryptoKeysRef                           = useRef<CryptoKeys | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('clipord_accounts')
      if (stored) setAccounts(JSON.parse(stored))
    } catch {
      setAccounts([])
    }
    setIsLoading(false)
  },[])

  useEffect(() => {
    if (!isVerified) return
    const handleVisibility = () => {
      if (document.hidden) {
        document.body.style.filter       = 'blur(20px)'
        document.body.style.pointerEvents = 'none'
      } else {
        document.body.style.filter       = ''
        document.body.style.pointerEvents = ''
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isVerified])

  const lockApp = useCallback(() => {
    setIsVerified(false)
    setIsLocked(true)
    cryptoKeysRef.current = null
    setCryptoKeysState(null)
    document.body.style.filter       = ''
    document.body.style.pointerEvents = ''
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  },[])

  const resetInactivity = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(lockApp, INACTIVITY_TIMEOUT_MS)
  }, [lockApp])

  useEffect(() => {
    if (!isVerified) return
    const events =['mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    const handler = () => resetInactivity()
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    resetInactivity()
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  },[isVerified, resetInactivity])

  const setCryptoKeys = useCallback((keys: CryptoKeys) => {
    cryptoKeysRef.current = keys
    setCryptoKeysState(keys)
  },[])

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
  },[])

  const addAccount = useCallback((account: Account) => {
    setAccounts((prev) => {
      const updated =[...prev.filter((a) => a.id !== account.id), account]
      localStorage.setItem('clipord_accounts', JSON.stringify(updated))
      return updated
    })
  },[])

  const removeAccount = useCallback(async (accountId: string) => {
    await wipeAccountCache(accountId)
    await db.deviceSettings.where({ accountId }).delete()
    localStorage.removeItem('clipord_totp_' + accountId)
    localStorage.removeItem('clipord_totp_enc_' + accountId)
    localStorage.removeItem('clipord_salt_' + accountId)
    localStorage.removeItem('clipord_bf_' + accountId)
    localStorage.removeItem('clipord_webauthn_' + accountId)
    localStorage.removeItem('clipord_sb_session_' + accountId)
    setAccounts((prev) => {
      const updated = prev.filter((a) => a.id !== accountId)
      localStorage.setItem('clipord_accounts', JSON.stringify(updated))
      return updated
    })
    if (activeAccountState?.id === accountId) {
      setActiveAccountState(null)
      setIsVerified(false)
      setCryptoKeysState(null)
      cryptoKeysRef.current = null
    }
  },[activeAccountState])

  const refreshSettings = useCallback(async () => {
    if (!activeAccountState) return
    const deviceId = getDeviceId()
    const settings = await getDeviceSettings(activeAccountState.id, deviceId)
    setDeviceSettings(settings ?? null)
  }, [activeAccountState])

  const saveDeviceSettings = useCallback(async (updates: Partial<DeviceSettings>, explicitAccountId?: string) => {
    const targetId = explicitAccountId || activeAccountState?.id
    if (!targetId) return
    const deviceId = getDeviceId()
    const current = await getDeviceSettings(targetId, deviceId)
    
    const next: DeviceSettings = {
      accountId: targetId,
      deviceId,
      verificationEnabled: true,
      verificationMethod: 'totp',
      cacheWipeAfterDays: null,
      lastActiveAt: new Date().toISOString(),
      ...current,
      ...updates,
    }
    
    await upsertDeviceSettings(next)
    if (targetId === activeAccountState?.id) {
      setDeviceSettings(next)
    }

    // Sync security preferences to Supabase so it's consistent across devices
    if (updates.verificationMethod || updates.cacheWipeAfterDays !== undefined) {
      await supabase.auth.updateUser({
        data: {
          verificationMethod: next.verificationMethod,
          cacheWipeAfterDays: next.cacheWipeAfterDays
        }
      })
    }
  },[activeAccountState])

  return (
    <AuthContext.Provider value={{
      accounts,
      activeAccount: activeAccountState,
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
      saveDeviceSettings,
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
