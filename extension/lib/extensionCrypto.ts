import browser from 'webextension-polyfill'
import { encryptText, decryptText, deriveExtensionStorageKey, bufToBase64 } from '@shared/crypto'
import { getDeviceId } from '@shared/platform'

async function getStorageKey(accountId: string): Promise<CryptoKey> {
  const deviceId = getDeviceId()
  return deriveExtensionStorageKey(accountId, deviceId)
}

export async function encryptForStorage(
  accountId: string,
  data: unknown
): Promise<string> {
  const key = await getStorageKey(accountId)
  const { ciphertext, iv } = await encryptText(JSON.stringify(data), key)
  return JSON.stringify({ ciphertext, iv })
}

export async function decryptFromStorage(
  accountId: string,
  encrypted: string
): Promise<unknown> {
  const key = await getStorageKey(accountId)
  const { ciphertext, iv } = JSON.parse(encrypted)
  const plaintext = await decryptText(ciphertext, iv, key)
  return JSON.parse(plaintext)
}

export async function saveEncryptedClips(
  accountId: string,
  clips: unknown[]
): Promise<void> {
  const encrypted = await encryptForStorage(accountId, clips)
  await browser.storage.local.set({ [`clipord_clips_${accountId}`]: encrypted })
}

export async function loadEncryptedClips(
  accountId: string
): Promise<unknown[]> {
  const result = await browser.storage.local.get(`clipord_clips_${accountId}`)
  const raw    = result[`clipord_clips_${accountId}`] as string | undefined
  if (!raw) return []
  try {
    return (await decryptFromStorage(accountId, raw)) as unknown[]
  } catch {
    return []
  }
}

export async function clearEncryptedClips(accountId: string): Promise<void> {
  await browser.storage.local.remove(`clipord_clips_${accountId}`)
}
