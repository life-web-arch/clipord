import { useCallback } from 'react'
import { supportsWebPush } from '@shared/platform'
import type { NotificationPayload } from '@shared/types'

export function useNotification() {
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') return true
    const result = await Notification.requestPermission()
    return result === 'granted'
  }, [])

  const subscribeToPush = useCallback(async (): Promise<PushSubscription | null> => {
    if (!supportsWebPush()) return null
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return existing
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string
    if (!vapidKey) return null
    return reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
  }, [])

  const showLocalNotification = useCallback(async (payload: NotificationPayload) => {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    reg.showNotification(payload.title, {
      body:    payload.body,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-96.png',
      tag:     payload.tag,
      data:    payload.url,
      actions: payload.actions,
      vibrate: [100, 50, 100],
    })
  }, [])

  return { requestPermission, subscribeToPush, showLocalNotification }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  const output  = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}
