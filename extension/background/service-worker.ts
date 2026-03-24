import browser from 'webextension-polyfill'
import { encryptText, decryptText, deriveExtensionStorageKey } from '@shared/crypto'
import { getDeviceId } from '@shared/platform'

const APP_URL = 'https://clipord.app'

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'clipord-root', title: 'Save to Clipord', contexts: ['selection'],
  })
  browser.contextMenus.create({
    id: 'clipord-personal', parentId: 'clipord-root',
    title: '🔒 Personal', contexts: ['selection'],
  })
})

browser.contextMenus.onClicked.addListener(async (info) => {
  if (!info.selectionText) return
  if (info.menuItemId === 'clipord-personal') {
    const accounts = await getStoredAccounts()
    if (accounts.length === 0) return
    // If only one account, save directly
    if (accounts.length === 1) {
      await saveClipEncrypted(accounts[0].id, info.selectionText, null)
      await notify('Clip saved to Personal')
    } else {
      // Show toast to pick account
      const tabs = await browser.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'SHOW_TOAST', preview: truncate(info.selectionText, 50),
          content: info.selectionText, accounts,
        })
      }
    }
  }
})

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'save-to-personal') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      browser.tabs.sendMessage(tabs[0].id, { type: 'GET_CLIPBOARD' })
    }
  }
})

browser.runtime.onMessage.addListener(async (message: Record<string, unknown>) => {
  if (message.type === 'CLIPBOARD_CONTENT') {
    await handleClipboardContent(message.content as string)
  }
  if (message.type === 'SAVE_CLIP') {
    await saveClipEncrypted(
      message.accountId as string,
      message.content   as string,
      message.spaceId   as string | null
    )
    await notify('📋 Clip saved')
    return true
  }
  if (message.type === 'GET_ACCOUNTS') {
    return getStoredAccounts()
  }
  if (message.type === 'CREATE_SPACE_AND_SAVE') {
    // Notify app to create space — open app in new tab with intent
    browser.tabs.create({
      url: `${APP_URL}/?intent=create-space&name=${encodeURIComponent(message.spaceName as string)}`
    })
    return true
  }
})

// ---- Core logic ----

async function handleClipboardContent(content: string) {
  if (!content?.trim()) return
  const accounts = await getStoredAccounts()
  if (accounts.length === 0) return

  // Check against encrypted last clipboard
  const isDuplicate = await isLastClipboard(content)
  if (isDuplicate) return
  await storeLastClipboard(content)

  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tabs[0]?.id) return

  browser.tabs.sendMessage(tabs[0].id, {
    type:     'SHOW_TOAST',
    preview:  truncate(content, 50),
    content,
    accounts,
  })
}

async function saveClipEncrypted(
  accountId: string,
  content: string,
  spaceId: string | null
): Promise<void> {
  const key = await getAccountStorageKey(accountId)
  if (!key) return

  const { ciphertext, iv } = await encryptText(content, key)
  const clip = {
    id:        crypto.randomUUID(),
    accountId,
    spaceId,
    ciphertext,
    iv,
    createdAt: new Date().toISOString(),
  }

  const storeKey = `clipord_clips_${accountId}`
  const existing = await browser.storage.local.get(storeKey)
  const rawList  = (existing[storeKey] as EncryptedClipRecord[] | undefined) ?? []
  rawList.push(clip)

  // Keep last 100 clips max
  const trimmed = rawList.slice(-100)
  await browser.storage.local.set({ [storeKey]: trimmed })
}

// ---- Last clipboard — stored encrypted ----

async function storeLastClipboard(content: string): Promise<void> {
  const accounts = await getStoredAccounts()
  if (accounts.length === 0) return
  const key = await getAccountStorageKey(accounts[0].id)
  if (!key) {
    // If no key available, store nothing — don't store plaintext
    return
  }
  const { ciphertext, iv } = await encryptText(content, key)
  await browser.storage.local.set({ clipord_last_cb: { ciphertext, iv, accountId: accounts[0].id } })
}

async function isLastClipboard(content: string): Promise<boolean> {
  const result = await browser.storage.local.get('clipord_last_cb')
  const stored = result.clipord_last_cb as { ciphertext: string; iv: string; accountId: string } | undefined
  if (!stored) return false
  try {
    const key = await getAccountStorageKey(stored.accountId)
    if (!key) return false
    const decrypted = await decryptText(stored.ciphertext, stored.iv, key)
    return decrypted === content
  } catch {
    return false
  }
}

async function getAccountStorageKey(accountId: string): Promise<CryptoKey | null> {
  try {
    const deviceId = getDeviceId()
    return deriveExtensionStorageKey(accountId, deviceId)
  } catch {
    return null
  }
}

async function getStoredAccounts(): Promise<StoredAccount[]> {
  const result = await browser.storage.local.get('clipord_accounts')
  return (result.clipord_accounts as StoredAccount[] | undefined) ?? []
}

async function notify(message: string): Promise<void> {
  await browser.notifications.create({
    type:    'basic',
    iconUrl: browser.runtime.getURL('icons/icon-48.png'),
    title:   'Clipord',
    message,
  })
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

// ---- Types ----

interface StoredAccount { id: string; email: string }
interface EncryptedClipRecord {
  id: string; accountId: string; spaceId: string | null
  ciphertext: string; iv: string; createdAt: string
}
