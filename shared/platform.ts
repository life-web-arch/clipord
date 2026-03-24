export type Platform = 'ios' | 'android' | 'desktop' | 'extension'

export function detectPlatform(): Platform {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) return 'extension'
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua))  return 'ios'
  if (/android/.test(ua))           return 'android'
  return 'desktop'
}

export function isIOS(): boolean {
  return detectPlatform() === 'ios'
}

export function isAndroid(): boolean {
  return detectPlatform() === 'android'
}

export function isDesktop(): boolean {
  return detectPlatform() === 'desktop'
}

export function isExtension(): boolean {
  return detectPlatform() === 'extension'
}

export function isPWA(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function supportsBiometric(): boolean {
  return typeof PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
}

export function supportsWebPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

export function supportsBackgroundSync(): boolean {
  return 'serviceWorker' in navigator && 'SyncManager' in window
}

export function supportsShareTarget(): boolean {
  return isAndroid() && isPWA()
}

export function supportsClipboardRead(): boolean {
  return navigator.clipboard !== undefined &&
    typeof navigator.clipboard.readText === 'function'
}

export function getDeviceId(): string {
  const key = 'clipord_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}
