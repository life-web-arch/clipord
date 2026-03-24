import { useState, useEffect, useCallback } from 'react'
import { isIOS, isAndroid, supportsClipboardRead } from '@shared/platform'
import { detectClipType, generatePreview } from '@shared/detector'
import type { ClipType } from '@shared/types'

interface DetectedClip {
  content: string
  type:    ClipType
  preview: string
}

export function useClipboardDetector(enabled: boolean) {
  const [detected, setDetected] = useState<DetectedClip | null>(null)
  const [lastContent, setLastContent] = useState<string>('')

  const readClipboard = useCallback(async () => {
    if (!supportsClipboardRead()) return
    try {
      const content = await navigator.clipboard.readText()
      if (!content || content === lastContent) return
      setLastContent(content)
      setDetected({
        content,
        type:    detectClipType(content),
        preview: generatePreview(content, 60),
      })
    } catch {
      // User denied clipboard permission — silent fail
    }
  }, [lastContent])

  useEffect(() => {
    if (!enabled) return

    // iOS and desktop PWA: detect on focus
    const onFocus = () => { readClipboard() }
    window.addEventListener('focus', onFocus)
    // Also check immediately on mount
    readClipboard()

    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, readClipboard])

  const dismiss = useCallback(() => setDetected(null), [])

  return { detected, dismiss }
}

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [])

  return { copy, copied }
}
