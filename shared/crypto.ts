// All cryptographic operations for Clipord
// Key design: true E2E — keys derived from a user-chosen passphrase,
// NEVER from server-held data like UUID.

const PBKDF2_ITERATIONS = 310_000
const PBKDF2_HASH       = 'SHA-256'
const AES_ALGO          = 'AES-GCM'
const AES_KEY_LENGTH    = 256
const IV_LENGTH         = 12
const HMAC_ALGO         = 'HMAC'
const HMAC_HASH         = 'SHA-256'

// ---------- Key derivation ----------

/**
 * Derive an AES-GCM key from a user-supplied passphrase + stored salt.
 * The salt must be stored on the device and synced (via Supabase user metadata)
 * so the same key is reproduced on every device.
 */
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
    .slice(0, Math.floor(bytes * 1.3))
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
    'raw', raw, { name: AES_ALGO, length: AES_KEY_LENGTH },
    false, ['encrypt', 'decrypt']
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

// ---------- Secure wipe ----------

export function wipeBuffer(buf: Uint8Array): void {
  buf.fill(0)
}

// ---------- TOTP secret storage — encrypted at rest in localStorage ----------

export async function storeTOTPSecret(
  accountId: string,
  secret: string,
  accountKey: CryptoKey
): Promise<void> {
  const { ciphertext, iv } = await encryptText(secret, accountKey)
  const integrity = await signData(ciphertext, accountKey)
  localStorage.setItem(
    'clipord_totp_enc_' + accountId,
    JSON.stringify({ ciphertext, iv, integrity, v: 1 })
  )
  // DO NOT delete the plaintext key here — extension relies on it.
  // Instead keep both: encrypted version for PWA, plaintext for extension bridge.
  // Extension bridge is in browser.storage.local, not localStorage.
}

export async function retrieveTOTPSecret(
  accountId: string,
  accountKey: CryptoKey
): Promise<string | null> {
  const raw = localStorage.getItem('clipord_totp_enc_' + accountId)
  if (!raw) {
    // Fallback: unencrypted legacy key
    return localStorage.getItem('clipord_totp_' + accountId)
  }
  try {
    const { ciphertext, iv, integrity } = JSON.parse(raw) as {
      ciphertext: string; iv: string; integrity: string
    }
    const valid = await verifyData(ciphertext, integrity, accountKey)
    if (!valid) {
      console.error('TOTP integrity check failed — possible tampering')
      return null
    }
    return decryptText(ciphertext, iv, accountKey)
  } catch {
    return null
  }
}

// ---------- Salt sync helpers ----------
// Salt must be the same on every device to produce the same AES key.
// We store it in Supabase user metadata so it's available everywhere.

export function getSaltKey(accountId: string): string {
  return 'clipord_salt_' + accountId
}

/**
 * Get or create the salt for an account.
 * On first device: generate random salt, save locally AND to Supabase metadata.
 * On subsequent devices: load from Supabase metadata, save locally.
 */
export async function getOrCreateSalt(
  accountId: string,
  fetchFromServer: () => Promise<string | null>,
  saveToServer: (salt: string) => Promise<void>
): Promise<Uint8Array> {
  const key = getSaltKey(accountId)

  // 1. Check local storage first
  const localSalt = localStorage.getItem(key)
  if (localSalt) return base64ToBuf(localSalt)

  // 2. Fetch from server (Supabase user metadata)
  const serverSalt = await fetchFromServer()
  if (serverSalt) {
    localStorage.setItem(key, serverSalt)
    return base64ToBuf(serverSalt)
  }

  // 3. First time ever — generate and save everywhere
  const salt = generateSalt()
  const saltB64 = bufToBase64(salt)
  localStorage.setItem(key, saltB64)
  await saveToServer(saltB64)
  return salt
}

// ---------- Extension storage key ----------

export async function deriveExtensionStorageKey(
  accountId: string,
  deviceId: string
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const raw = enc.encode(accountId + ':' + deviceId + ':clipord-ext-storage')
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
