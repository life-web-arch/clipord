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
      // Query permission safely before executing to avoid aggressive browser prompting loops
      const permission = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
      if (permission.state === 'denied') return

      const content = await navigator.clipboard.readText()
      if (!content || content === lastContent) return
      
      setLastContent(content)
      setDetected({
        content,
        type:    detectClipType(content),
        preview: generatePreview(content, 60),
      })
    } catch (err) {
      // User denied clipboard permission or document is not focused — silent fail
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
  },[enabled, readClipboard])

  const dismiss = useCallback(() => setDetected(null),[])

  return { detected, dismiss }
}

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        throw new Error('Clipboard API not available')
      }
    } catch {
      // Fallback for older browsers or non-secure contexts
      try {
        const el = document.createElement('textarea')
        el.value = text
        
        // Prevent scrolling to bottom of page in MS Edge
        el.setAttribute('readonly', '')
        el.style.position = 'absolute'
        el.style.left = '-9999px'
        
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
        
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackErr) {
        console.error('All clipboard copy methods failed', fallbackErr)
      }
    }
  },[])

  return { copy, copied }
}
