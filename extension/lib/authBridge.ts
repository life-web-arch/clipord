/**
 * Auth Bridge: syncs account data between PWA (localStorage) and extension (browser.storage.local).
 *
 * Problem: PWA stores accounts in DOM localStorage. Extension service worker has no access to that.
 * Solution: PWA calls syncAccountsToExtension() after login. Extension reads from browser.storage.local.
 *
 * This file is imported by BOTH the PWA (src/main.tsx) and extension popup.
 */

import browser from 'webextension-polyfill'
import type { ExtAccountRecord } from '@shared/types'

const EXT_ACCOUNTS_KEY = 'clipord_ext_accounts'
const EXT_DEVICE_KEY   = 'clipord_ext_device_id'

/** Called from PWA after successful login to bridge account data to extension */
export async function syncAccountToExtension(
  accountId: string,
  email: string,
  totpSecret: string
): Promise<void> {
  if (!('storage' in browser)) return
  const result   = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  const existing = (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ?? []
  const filtered = existing.filter((a) => a.id !== accountId)
  const record: ExtAccountRecord = {
    id:         accountId,
    email,
    totpSecret, // plaintext — extension cannot run WebCrypto decrypt from PWA's key
    createdAt:  new Date().toISOString(),
  }
  await browser.storage.local.set({ [EXT_ACCOUNTS_KEY]: [...filtered, record] })
}

/** Called from extension popup to get all bridged accounts */
export async function getExtAccounts(): Promise<ExtAccountRecord[]> {
  const result = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  return (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ?? []
}

/** Remove an account from extension storage */
export async function removeExtAccount(accountId: string): Promise<void> {
  const result   = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  const existing = (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ?? []
  const filtered = existing.filter((a) => a.id !== accountId)
  await browser.storage.local.set({ [EXT_ACCOUNTS_KEY]: filtered })
}

/** Stable device ID stored in extension storage (not localStorage — unavailable in SW) */
export async function getExtDeviceId(): Promise<string> {
  const result = await browser.storage.local.get(EXT_DEVICE_KEY)
  let id = result[EXT_DEVICE_KEY] as string | undefined
  if (!id) {
    id = crypto.randomUUID()
    await browser.storage.local.set({ [EXT_DEVICE_KEY]: id })
  }
  return id
}
