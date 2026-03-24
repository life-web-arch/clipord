import browser from 'webextension-polyfill'
import { getExtAccounts, getExtDeviceId } from '../lib/authBridge'
import { encryptText, decryptText } from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import { addClipEncrypted } from '../lib/extensionCrypto'
import type { StoredClip } from '../lib/extensionCrypto'

// SAFE: getDeviceId via browser.storage, NOT localStorage
async function getDeviceId(): Promise<string> {
  return getExtDeviceId()
}

// ---- Context menus — use removeAll to prevent duplicate ID crash ----
browser.runtime.onInstalled.addListener(async () => {
  await browser.contextMenus.removeAll()
  browser.contextMenus.create({
    id:       'clipord-root',
    title:    'Save to Clipord',
    contexts: ['selection'],
  })
  browser.contextMenus.create({
    id:       'clipord-personal',
    parentId: 'clipord-root',
    title:    '🔒 Personal',
    contexts: ['selection'],
  })
})

// Also remove/recreate on startup to handle SW restarts
browser.runtime.onStartup?.addListener(async () => {
  await browser.contextMenus.removeAll()
  browser.contextMenus.create({
    id:       'clipord-root',
    title:    'Save to Clipord',
    contexts: ['selection'],
  })
  browser.contextMenus.create({
    id:       'clipord-personal',
    parentId: 'clipord-root',
    title:    '🔒 Personal',
    contexts: ['selection'],
  })
})

browser.contextMenus.onClicked.addListener(async (info) => {
  if (!info.selectionText || info.menuItemId !== 'clipord-personal') return
  const accounts = await getExtAccounts()
  if (accounts.length === 0) {
    await notify('Open Clipord app to sign in first')
    return
  }
  if (accounts.length === 1) {
    await saveClip(accounts[0].id, info.selectionText, null)
    await notify('📋 Clip saved to Personal')
  } else {
    // Multiple accounts — show toast in active tab
    await showToastInActiveTab(info.selectionText, accounts)
  }
})

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'save-to-personal') {
    await showToastInActiveTab(null, await getExtAccounts())
  }
})

browser.runtime.onMessage.addListener(async (message: Record<string, unknown>) => {
  const type = message['type'] as string

  if (type === 'SAVE_CLIP') {
    await saveClip(
      message['accountId'] as string,
      message['content']   as string,
      message['spaceId']   as string | null
    )
    await notify('📋 Clip saved')
    return true
  }

  if (type === 'CLIPBOARD_CONTENT') {
    await handleClipboardContent(message['content'] as string)
    return true
  }

  if (type === 'GET_EXT_ACCOUNTS') {
    return getExtAccounts()
  }

  if (type === 'CREATE_SPACE_AND_SAVE') {
    const appUrl = 'https://clipord.app'
    const name   = encodeURIComponent(message['spaceName'] as string)
    await browser.tabs.create({ url: appUrl + '/?intent=create-space&name=' + name })
    return true
  }
})

async function saveClip(
  accountId: string,
  content: string,
  spaceId: string | null
): Promise<void> {
  const clip: StoredClip = {
    id:        crypto.randomUUID(),
    accountId,
    spaceId,
    content,
    type:      detectClipType(content),
    preview:   generatePreview(content, 60),
    createdAt: new Date().toISOString(),
  }
  await addClipEncrypted(accountId, clip)
}

async function handleClipboardContent(content: string): Promise<void> {
  if (!content?.trim()) return
  const accounts = await getExtAccounts()
  if (accounts.length === 0) return

  // Deduplicate using encrypted last clipboard
  if (await isLastClipboard(content)) return
  await storeLastClipboard(content)

  await showToastInActiveTab(content, accounts)
}

async function showToastInActiveTab(
  content: string | null,
  accounts: { id: string; email: string }[]
): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tab  = tabs[0]
  if (!tab?.id) return

  // Skip restricted URLs that don't allow content scripts
  const url = tab.url ?? ''
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url === ''
  ) return

  try {
    await browser.tabs.sendMessage(tab.id, {
      type:     'SHOW_TOAST',
      preview:  content ? truncate(content, 50) : '',
      content:  content ?? '',
      accounts: accounts.map((a) => ({ id: a.id, email: a.email })),
    })
  } catch {
    // Tab may not have content script — silent fail
  }
}

// ---- Encrypted last clipboard ----

async function storeLastClipboard(content: string): Promise<void> {
  const accounts = await getExtAccounts()
  if (accounts.length === 0) return
  const accountId = accounts[0].id
  const deviceId  = await getExtDeviceId()
  // Simple key derivation without localStorage
  const enc = new TextEncoder()
  const raw = enc.encode(accountId + ':' + deviceId + ':last-cb')
  const km  = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey'])
  const salt = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
  const key  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const { ciphertext, iv } = await encryptText(content, key)
  await browser.storage.local.set({
    clipord_last_cb: JSON.stringify({ ciphertext, iv, accountId })
  })
}

async function isLastClipboard(content: string): Promise<boolean> {
  const result = await browser.storage.local.get('clipord_last_cb')
  const raw    = result['clipord_last_cb'] as string | undefined
  if (!raw) return false
  try {
    const { ciphertext, iv, accountId } = JSON.parse(raw) as {
      ciphertext: string; iv: string; accountId: string
    }
    const deviceId = await getExtDeviceId()
    const enc      = new TextEncoder()
    const rawKey   = enc.encode(accountId + ':' + deviceId + ':last-cb')
    const km       = await crypto.subtle.importKey('raw', rawKey, 'PBKDF2', false, ['deriveKey'])
    const salt     = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
    const key      = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
    const decrypted = await decryptText(ciphertext, iv, key)
    return decrypted === content
  } catch {
    return false
  }
}

async function notify(message: string): Promise<void> {
  try {
    await browser.notifications.create({
      type:    'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title:   'Clipord',
      message,
    })
  } catch { /* Notification permissions may be denied */ }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}
