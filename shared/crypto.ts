const PBKDF2_ITERATIONS = 310_000
const PBKDF2_HASH      = 'SHA-256'
const AES_ALGO         = 'AES-GCM'
const AES_KEY_LENGTH   = 256
const IV_LENGTH        = 12

export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

export async function generateSpaceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key)
}

export async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptText(
  plaintext: string,
  key: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder()
  const iv  = generateIV()
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv },
    key,
    enc.encode(plaintext)
  )
  return {
    ciphertext: bufToBase64(encrypted),
    iv:         bufToBase64(iv),
  }
}

export async function decryptText(
  ciphertext: string,
  iv: string,
  key: CryptoKey
): Promise<string> {
  const dec = new TextDecoder()
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv: base64ToBuf(iv) },
    key,
    base64ToBuf(ciphertext)
  )
  return dec.decode(decrypted)
}

export async function encryptSpaceKey(
  spaceKey: CryptoKey,
  accountKey: CryptoKey
): Promise<{ encryptedSpaceKey: string; iv: string }> {
  const raw = await exportKey(spaceKey)
  const iv  = generateIV()
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv },
    accountKey,
    raw
  )
  return {
    encryptedSpaceKey: bufToBase64(encrypted),
    iv:                bufToBase64(iv),
  }
}

export async function decryptSpaceKey(
  encryptedSpaceKey: string,
  iv: string,
  accountKey: CryptoKey
): Promise<CryptoKey> {
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv: base64ToBuf(iv) },
    accountKey,
    base64ToBuf(encryptedSpaceKey)
  )
  return importKey(decrypted)
}

export function bufToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer)
  let binary  = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function base64ToBuf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function generateDeviceId(): string {
  const arr = crypto.getRandomValues(new Uint8Array(16))
  return bufToBase64(arr).replace(/[+/=]/g, '').slice(0, 16)
}
