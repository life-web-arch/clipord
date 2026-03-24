// All cryptographic operations for Clipord
// Key design: true E2E — keys derived from a user-chosen passphrase,
// NEVER from server-held data like UUID.

const PBKDF2_ITERATIONS = 310_000
const PBKDF2_HASH       = 'SHA-256'
const AES_ALGO          = 'AES-GCM'
const AES_KEY_LENGTH    = 256
const IV_LENGTH         = 12

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
  // AES-GCM automatically throws an operation error if the data was tampered with
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
    false,['encrypt', 'decrypt']
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
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(
      'clipord_totp_enc_' + accountId,
      JSON.stringify({ ciphertext, iv, v: 2 })
    )
  }
}

export async function retrieveTOTPSecret(
  accountId: string,
  accountKey: CryptoKey
): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;

  const raw = localStorage.getItem('clipord_totp_enc_' + accountId)
  if (!raw) {
    // Fallback: unencrypted legacy key (Auto-Migrate)
    const plaintext = localStorage.getItem('clipord_totp_' + accountId)
    if (plaintext) {
      await storeTOTPSecret(accountId, plaintext, accountKey)
      localStorage.removeItem('clipord_totp_' + accountId)
      return plaintext
    }
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return await decryptText(parsed.ciphertext, parsed.iv, accountKey)
  } catch (err) {
    console.error("Failed to decrypt TOTP secret", err)
    return null
  }
}

// ---------- Salt sync helpers ----------

export function getSaltKey(accountId: string): string {
  return 'clipord_salt_' + accountId
}

export async function getOrCreateSalt(
  accountId: string,
  fetchFromServer: () => Promise<string | null>,
  saveToServer: (salt: string) => Promise<void>
): Promise<Uint8Array> {
  const key = getSaltKey(accountId)

  // 1. Check local storage first
  if (typeof localStorage !== 'undefined') {
    const localSalt = localStorage.getItem(key)
    if (localSalt) return base64ToBuf(localSalt)
  }

  // 2. Fetch from server (Supabase user metadata)
  const serverSalt = await fetchFromServer()
  if (serverSalt) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, serverSalt)
    return base64ToBuf(serverSalt)
  }

  // 3. First time ever — generate and save everywhere
  const salt = generateSalt()
  const saltB64 = bufToBase64(salt)
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, saltB64)
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
