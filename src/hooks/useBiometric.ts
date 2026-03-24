import { useCallback } from 'react'
import { supportsBiometric } from '@shared/platform'

export function useBiometric() {
  const isAvailable = useCallback(async (): Promise<boolean> => {
    if (!supportsBiometric()) return false
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  }, [])

  const register = useCallback(async (accountId: string, email: string): Promise<boolean> => {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      if (!available) return false
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const userId    = new TextEncoder().encode(accountId)
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp:   { name: 'Clipord', id: window.location.hostname },
          user: { id: userId, name: email, displayName: email },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7  },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification:        'required',
            residentKey:             'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null
      if (!credential) return false
      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
      localStorage.setItem(`clipord_webauthn_${accountId}`, credId)
      return true
    } catch {
      return false
    }
  }, [])

  const verify = useCallback(async (accountId: string): Promise<boolean> => {
    try {
      const credIdStr = localStorage.getItem(`clipord_webauthn_${accountId}`)
      if (!credIdStr) return false
      const credIdBytes = Uint8Array.from(atob(credIdStr), (c) => c.charCodeAt(0))
      const challenge   = crypto.getRandomValues(new Uint8Array(32))
      const assertion   = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: credIdBytes, type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null
      return assertion !== null
    } catch {
      return false
    }
  }, [])

  return { isAvailable, register, verify }
}
