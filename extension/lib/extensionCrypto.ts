import browser from 'webextension-polyfill'
import { encryptText, decryptText, deriveExtensionStorageKey } from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import { getDeviceId } from '@shared/platform'
import type { ClipType } from '@shared/types'

// ---- Internal StoredClip type ----
// This is the shape saved inside the encrypted blob.
// It carries content (decrypted), type, and preview so the popup
// can display clips without re-deriving the account key.
export interface StoredClip {
  id:        string
  accountId: string
  spaceId:   string | null
  content:   string
  type:      ClipType
  preview:   string
  createdAt: string
}

async function getStorageKey(accountId: string): Promise<CryptoKey> {
  const deviceId = getDeviceId()
  return deriveExtensionStorageKey(accountId, deviceId)
}

// ---- Low-level encrypt / decrypt ----

async function encryptForStorage(accountId: string, data: unknown): Promise<string> {
  const key = await getStorageKey(accountId)
  const { ciphertext, iv } = await encryptText(JSON.stringify(data), key)
  return JSON.stringify({ ciphertext, iv })
}

async function decryptFromStorage(accountId: string, encrypted: string): Promise<unknown> {
  const key = await getStorageKey(accountId)
  const { ciphertext, iv } = JSON.parse(encrypted) as { ciphertext: string; iv: string }
  const plaintext = await decryptText(ciphertext, iv, key)
  return JSON.parse(plaintext)
}

// ---- Public API used by Popup and service-worker ----

export async function saveEncryptedClips(
  accountId: string,
  clips: StoredClip[]
): Promise<void> {
  // Ensure type + preview are always set before saving
  const hydrated = clips.map((c) => ({
    ...c,
    type:    c.type    ?? detectClipType(c.content),
    preview: c.preview ?? generatePreview(c.content, 60),
  }))
  const encrypted = await encryptForStorage(accountId, hydrated)
  await browser.storage.local.set({ [`clipord_clips_${accountId}`]: encrypted })
}

export async function loadEncryptedClips(accountId: string): Promise<StoredClip[]> {
  const storeKey = `clipord_clips_${accountId}`
  const result   = await browser.storage.local.get(storeKey)
  const raw      = result[storeKey] as string | undefined
  if (!raw) return []
  try {
    const clips = (await decryptFromStorage(accountId, raw)) as StoredClip[]
    // Re-hydrate type + preview in case of legacy records
    return clips.map((c) => ({
      ...c,
      type:    c.type    ?? detectClipType(c.content),
      preview: c.preview ?? generatePreview(c.content, 60),
    }))
  } catch {
    return []
  }
}

export async function clearEncryptedClips(accountId: string): Promise<void> {
  await browser.storage.local.remove(`clipord_clips_${accountId}`)
}
