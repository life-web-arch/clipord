import browser from 'webextension-polyfill'

const CLIPORD_APP_URL = process.env.VITE_APP_URL ?? 'https://clipord.app'

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id:       'clipord-save',
    title:    'Save to Clipord',
    contexts: ['selection'],
  })
  browser.contextMenus.create({
    id:       'clipord-save-personal',
    parentId: 'clipord-save',
    title:    '🔒 Personal',
    contexts: ['selection'],
  })
})

browser.contextMenus.onClicked.addListener(async (info) => {
  if (!info.selectionText) return
  if (info.menuItemId === 'clipord-save-personal') {
    await sendToBackground({ type: 'SAVE_CLIP', content: info.selectionText, spaceId: null })
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
    await saveClipToStorage(
      message.content as string,
      message.spaceId as string | null,
      message.accountId as string
    )
  }
  if (message.type === 'GET_ACCOUNTS') {
    const accounts = await getStoredAccounts()
    return accounts
  }
})

async function handleClipboardContent(content: string) {
  if (!content?.trim()) return
  const accounts = await getStoredAccounts()
  if (accounts.length === 0) return
  const lastContent = await getLastClipboardContent()
  if (content === lastContent) return
  await setLastClipboardContent(content)
  await showSaveToast(content, accounts)
}

async function showSaveToast(content: string, accounts: StoredAccount[]) {
  const preview = content.length > 50 ? content.slice(0, 50) + '...' : content
  const tabs    = await browser.tabs.query({ active: true, currentWindow: true })
  if (tabs[0]?.id) {
    browser.tabs.sendMessage(tabs[0].id, {
      type:     'SHOW_TOAST',
      preview,
      content,
      accounts,
    })
  }
}

async function saveClipToStorage(content: string, spaceId: string | null, accountId: string) {
  const pending = await browser.storage.local.get('pending_clips')
  const clips: PendingClip[] = pending.pending_clips ?? []
  clips.push({
    id:        crypto.randomUUID(),
    content,
    spaceId,
    accountId,
    createdAt: new Date().toISOString(),
  })
  await browser.storage.local.set({ pending_clips: clips })
  await browser.notifications.create({
    type:    'basic',
    iconUrl: browser.runtime.getURL('icons/icon-48.png'),
    title:   'Clipord',
    message: '📋 Clip saved',
  })
}

async function getStoredAccounts(): Promise<StoredAccount[]> {
  const result = await browser.storage.local.get('clipord_accounts')
  return result.clipord_accounts ?? []
}

async function getLastClipboardContent(): Promise<string> {
  const result = await browser.storage.local.get('last_clipboard')
  return result.last_clipboard ?? ''
}

async function setLastClipboardContent(content: string): Promise<void> {
  await browser.storage.local.set({ last_clipboard: content })
}

async function sendToBackground(message: Record<string, unknown>) {
  return browser.runtime.sendMessage(message)
}

interface StoredAccount {
  id:    string
  email: string
}

interface PendingClip {
  id:        string
  content:   string
  spaceId:   string | null
  accountId: string
  createdAt: string
}
