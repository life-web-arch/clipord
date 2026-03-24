import browser from 'webextension-polyfill'
import { syncAccountToExtension, getExtAccounts, getExtDeviceId } from '../lib/authBridge'
import { encryptText, decryptText } from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import { addClipEncrypted } from '../lib/extensionCrypto'
import type { StoredClip } from '../lib/extensionCrypto'

async function getDeviceId(): Promise<string> {
  return getExtDeviceId()
}

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

  if (type === 'SYNC_ACCOUNT') {
    const payload = message['payload'] as Record<string, any>
    if (payload && payload.accountId && payload.email && payload.totpSecret) {
      await syncAccountToExtension(payload.accountId, payload.email, payload.totpSecret, payload.sbSession)
    }
    return true
  }

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

async function pushClipToSupabaseRemote(clip: StoredClip, accountId: string) {
  try {
    const accounts = await getExtAccounts()
    const act = accounts.find(a => a.id === accountId)
    if (!act || !act.sbSession) return

    const { supabaseUrl, anonKey, session } = act.sbSession
    if (!supabaseUrl || !anonKey || !session?.access_token) return

    const url = `${supabaseUrl}/rest/v1/clips`
    
    // Format JSON as Supabase Expects snake_case
    const payload = {
      id: clip.id,
      account_id: clip.accountId,
      space_id: clip.spaceId,
      type: clip.type,
      preview: clip.preview,
      encrypted_content: clip.encryptedContent,
      iv: clip.iv,
      pinned: false,
      tags:[],
      wipe_at: null,
      created_at: clip.createdAt,
      updated_at: clip.createdAt
    }

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${session.access_token}`,
        'Prefer': 'resolution=minimal'
      },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    console.error("Failed to push clip to Supabase remote", err)
  }
}

async function saveClip(
  accountId: string,
  content: string,
  spaceId: string | null
): Promise<void> {
  const enc = new TextEncoder()
  const deviceId = await getExtDeviceId()
  const rawKey = enc.encode(accountId + ':' + deviceId + ':clipord-ext-storage')
  const km = await crypto.subtle.importKey('raw', rawKey, 'PBKDF2', false, ['deriveKey'])
  const salt = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
  const accountKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  )

  const { ciphertext, iv } = await encryptText(content, accountKey)

  // Use StoredClip interface with encrypted contents
  const clip: any = {
    id:        crypto.randomUUID(),
    accountId,
    spaceId,
    content,  // will be saved as encrypted
    encryptedContent: ciphertext,
    iv,
    type:      detectClipType(content),
    preview:   generatePreview(content, 60),
    createdAt: new Date().toISOString(),
  }
  
  await addClipEncrypted(accountId, clip)
  await pushClipToSupabaseRemote(clip, accountId)
}

async function handleClipboardContent(content: string): Promise<void> {
  if (!content?.trim()) return
  const accounts = await getExtAccounts()
  if (accounts.length === 0) return

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

async function storeLastClipboard(content: string): Promise<void> {
  const accounts = await getExtAccounts()
  if (accounts.length === 0) return
  const accountId = accounts[0].id
  const deviceId  = await getExtDeviceId()
  
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
    const km       = await crypto.subtle.importKey('raw', rawKey, 'PBKDF2', false,['deriveKey'])
    const salt     = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
    const key      = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,['encrypt', 'decrypt']
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
