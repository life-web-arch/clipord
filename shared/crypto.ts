const AES_ALGO          = 'AES-GCM'
const AES_KEY_LENGTH    = 256
const IV_LENGTH         = 12

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    true,['encrypt', 'decrypt']
  )
}

export async function exportVaultKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bufToBase64(raw)
}

export async function importVaultKey(b64: string): Promise<CryptoKey> {
  const raw = base64ToBuf(b64)
  return crypto.subtle.importKey('raw', raw, { name: AES_ALGO, length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt'])
}

export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH))
}

export function generateToken(bytes = 32): string {
  return bufToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/[+/=]/g, '')
    .slice(0, Math.floor(bytes * 1.3))
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

export async function generateSpaceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function encryptSpaceKey(
  spaceKey: CryptoKey,
  accountKey: CryptoKey
): Promise<{ encryptedSpaceKey: string; iv: string }> {
  const raw = await crypto.subtle.exportKey('raw', spaceKey)
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
  return crypto.subtle.importKey(
    'raw', decrypted, { name: AES_ALGO, length: AES_KEY_LENGTH },
    false, ['encrypt', 'decrypt']
  )
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export function wipeBuffer(buf: Uint8Array): void {
  buf.fill(0)
}

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

  try {
    const { supabase } = await import('./supabase')
    await supabase.auth.updateUser({
      data: { encrypted_totp_secret: ciphertext, totp_iv: iv }
    })
  } catch(e) {
    console.warn('Could not sync TOTP secret to Supabase', e)
  }
}

export async function retrieveTOTPSecret(
  accountId: string,
  accountKey: CryptoKey
): Promise<string | null> {
  let ciphertext: string | undefined
  let iv: string | undefined

  try {
    const { supabase } = await import('./supabase')
    const { data } = await supabase.auth.getUser()
    ciphertext = data?.user?.user_metadata?.encrypted_totp_secret
    iv = data?.user?.user_metadata?.totp_iv
  } catch(e) {}

  if (!ciphertext || !iv) {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('clipord_totp_enc_' + accountId)
    
    if (raw) {
      const parsed = JSON.parse(raw)
      ciphertext = parsed.ciphertext
      iv = parsed.iv
    } else {
      const plaintext = localStorage.getItem('clipord_totp_' + accountId)
      if (plaintext) {
        await storeTOTPSecret(accountId, plaintext, accountKey)
        localStorage.removeItem('clipord_totp_' + accountId)
        return plaintext
      }
      return null
    }
  }

  if (ciphertext && iv) {
    try {
      const secret = await decryptText(ciphertext, iv, accountKey)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('clipord_totp_enc_' + accountId, JSON.stringify({ ciphertext, iv, v: 2 }))
      }
      return secret
    } catch (err) {
      // Throw explicitly so the UI knows the Vault Key was wrong
      throw new Error('DECRYPTION_FAILED')
    }
  }
  return null
}

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
