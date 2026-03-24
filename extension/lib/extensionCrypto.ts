import browser from 'webextension-polyfill'
import { encryptText, decryptText } from '@shared/crypto'
import { getExtDeviceId } from './authBridge'

// Derive a key from account ID + device ID without using localStorage
async function getStorageKey(accountId: string): Promise<CryptoKey> {
  const deviceId = await getExtDeviceId()
  const enc      = new TextEncoder()
  const raw      = enc.encode(accountId + ':' + deviceId + ':clipord-ext-storage')
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey'])
  const salt     = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function saveClipsEncrypted(
  accountId: string,
  clips: StoredClip[]
): Promise<void> {
  const key = await getStorageKey(accountId)
  const { ciphertext, iv } = await encryptText(JSON.stringify(clips), key)
  await browser.storage.local.set({
    ['clipord_clips_' + accountId]: JSON.stringify({ ciphertext, iv })
  })
}

export async function loadClipsEncrypted(accountId: string): Promise<StoredClip[]> {
  const key    = await getStorageKey(accountId)
  const result = await browser.storage.local.get('clipord_clips_' + accountId)
  const raw    = result['clipord_clips_' + accountId] as string | undefined
  if (!raw) return []
  try {
    const { ciphertext, iv } = JSON.parse(raw) as { ciphertext: string; iv: string }
    const plaintext = await decryptText(ciphertext, iv, key)
    return JSON.parse(plaintext) as StoredClip[]
  } catch {
    return []
  }
}

export async function addClipEncrypted(
  accountId: string,
  clip: StoredClip
): Promise<void> {
  const existing = await loadClipsEncrypted(accountId)
  const updated  = [...existing, clip].slice(-100)
  await saveClipsEncrypted(accountId, updated)
}

export async function deleteClipEncrypted(
  accountId: string,
  clipId: string
): Promise<void> {
  const existing = await loadClipsEncrypted(accountId)
  await saveClipsEncrypted(accountId, existing.filter((c) => c.id !== clipId))
}

export interface StoredClip {
  id:        string
  accountId: string
  spaceId:   string | null
  content:   string
  type:      string
  preview:   string
  createdAt: string
}
