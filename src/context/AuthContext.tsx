import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, getCurrentUser } from '@shared/supabase'
import { getDeviceId } from '@shared/platform'
import { db, getDeviceSettings } from '@shared/db'
import type { Account, DeviceSettings, CryptoKeys } from '@shared/types'

interface AuthContextValue {
  accounts:         Account[]
  activeAccount:    Account | null
  deviceSettings:   DeviceSettings | null
  cryptoKeys:       CryptoKeys | null
  isVerified:       boolean
  isLoading:        boolean
  setActiveAccount: (account: Account) => void
  setVerified:      (verified: boolean) => void
  setCryptoKeys:    (keys: CryptoKeys) => void
  addAccount:       (account: Account) => void
  removeAccount:    (accountId: string) => void
  refreshSettings:  () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]             = useState<Account[]>([])
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null)
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings | null>(null)
  const [cryptoKeys, setCryptoKeys]         = useState<CryptoKeys | null>(null)
  const [isVerified, setVerified]           = useState(false)
  const [isLoading, setIsLoading]           = useState(true)

  const loadAccounts = useCallback(async () => {
    const stored = localStorage.getItem('clipord_accounts')
    if (stored) {
      try {
        const parsed: Account[] = JSON.parse(stored)
        setAccounts(parsed)
      } catch {
        setAccounts([])
      }
    }
    setIsLoading(false)
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const setActiveAccount = useCallback(async (account: Account) => {
    setActiveAccountState(account)
    setVerified(false)
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
    await db.clips.where({ accountId }).delete()
    await db.deviceSettings.where({ accountId }).delete()
    setAccounts((prev) => {
      const updated = prev.filter((a) => a.id !== accountId)
      localStorage.setItem('clipord_accounts', JSON.stringify(updated))
      return updated
    })
    if (activeAccount?.id === accountId) {
      setActiveAccountState(null)
      setVerified(false)
      setCryptoKeys(null)
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
      setActiveAccount,
      setVerified,
      setCryptoKeys,
      addAccount,
      removeAccount,
      refreshSettings,
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
