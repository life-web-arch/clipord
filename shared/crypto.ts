const PBKDF2_ITERATIONS  = 310_000
const PBKDF2_HASH        = 'SHA-256'
const AES_ALGO           = 'AES-GCM'
const AES_KEY_LENGTH     = 256
const IV_LENGTH          = 12
const HMAC_ALGO          = 'HMAC'
const HMAC_HASH          = 'SHA-256'

// ---------- Key derivation ----------

export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function deriveHMACKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    { name: HMAC_ALGO, hash: HMAC_HASH },
    false,
    ['sign', 'verify']
  )
}

// ---------- Random primitives ----------

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

export function generateToken(bytes = 32): string {
  return bufToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/[+/=]/g, '')
    .slice(0, bytes * 1.3 | 0)
}

// ---------- AES-GCM encrypt / decrypt ----------

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
  return { ciphertext: bufToBase64(encrypted), iv: bufToBase64(iv) }
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

// ---------- Space key wrap / unwrap ----------

export async function generateSpaceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
  )
}

export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key)
}

export async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', raw, { name: AES_ALGO, length: AES_KEY_LENGTH }, false, ['encrypt', 'decrypt']
  )
}

export async function encryptSpaceKey(
  spaceKey: CryptoKey,
  accountKey: CryptoKey
): Promise<{ encryptedSpaceKey: string; iv: string }> {
  const raw = await exportKey(spaceKey)
  const iv  = generateIV()
  const encrypted = await crypto.subtle.encrypt({ name: AES_ALGO, iv }, accountKey, raw)
  return { encryptedSpaceKey: bufToBase64(encrypted), iv: bufToBase64(iv) }
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

// ---------- HMAC integrity ----------

export async function signData(data: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder()
  const sig = await crypto.subtle.sign(HMAC_ALGO, key, enc.encode(data))
  return bufToBase64(sig)
}

export async function verifyData(
  data: string,
  signature: string,
  key: CryptoKey
): Promise<boolean> {
  const enc = new TextEncoder()
  return crypto.subtle.verify(
    HMAC_ALGO, key, base64ToBuf(signature), enc.encode(data)
  )
}

// ---------- Constant-time comparison ----------

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ---------- Secure wipe helpers ----------

export function wipeString(str: string): void {
  // Strings are immutable in JS — we can zero the array if we have it
  // This is a best-effort hint; GC controls actual memory
  try {
    const buf = new TextEncoder().encode(str)
    buf.fill(0)
  } catch { /* silent */ }
}

export function wipeBuffer(buf: Uint8Array): void {
  buf.fill(0)
}

// ---------- TOTP secret integrity ----------

export async function storeTOTPSecret(
  accountId: string,
  secret: string,
  accountKey: CryptoKey
): Promise<void> {
  const { ciphertext, iv } = await encryptText(secret, accountKey)
  const integrity = await signData(ciphertext, accountKey)
  localStorage.setItem(`clipord_totp_enc_${accountId}`, JSON.stringify({
    ciphertext, iv, integrity, v: 1
  }))
  // Remove any old plaintext version
  localStorage.removeItem(`clipord_totp_${accountId}`)
}

export async function retrieveTOTPSecret(
  accountId: string,
  accountKey: CryptoKey
): Promise<string | null> {
  // Check for old plaintext format and migrate
  const legacy = localStorage.getItem(`clipord_totp_${accountId}`)
  if (legacy) {
    await storeTOTPSecret(accountId, legacy, accountKey)
    localStorage.removeItem(`clipord_totp_${accountId}`)
  }

  const raw = localStorage.getItem(`clipord_totp_enc_${accountId}`)
  if (!raw) return null
  try {
    const { ciphertext, iv, integrity } = JSON.parse(raw)
    const valid = await verifyData(ciphertext, integrity, accountKey)
    if (!valid) {
      console.error('TOTP secret integrity check failed — possible tampering')
      return null
    }
    return decryptText(ciphertext, iv, accountKey)
  } catch {
    return null
  }
}

// ---------- Encoding helpers ----------

export function bufToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes  = new Uint8Array(buffer)
  let binary   = ''
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

// ---------- Extension storage encryption ----------

export async function deriveExtensionStorageKey(
  accountId: string,
  deviceId: string
): Promise<CryptoKey> {
  const enc  = new TextEncoder()
  const raw  = enc.encode(`${accountId}:${deviceId}:clipord-ext-storage`)
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey'])
  const salt = enc.encode(accountId.slice(0, 16).padEnd(16, '0'))
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: PBKDF2_HASH },
    keyMaterial,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}
