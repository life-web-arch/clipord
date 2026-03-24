import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// ---- PWA Install prompt ----
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let _installPrompt: BeforeInstallPromptEvent | null = null

export function getInstallPrompt(): BeforeInstallPromptEvent | null { return _installPrompt }
export function clearInstallPrompt(): void { _installPrompt = null }

// Capture install prompt as early as possible
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  _installPrompt = e as BeforeInstallPromptEvent
  window.dispatchEvent(new CustomEvent('clipord:install-available'))
}, { once: false })

window.addEventListener('appinstalled', () => {
  _installPrompt = null
})

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (nw) {
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('clipord:sw-updated'))
              }
            })
          }
        })
      })
      .catch(console.error)
  })
}

// ---- Extension auth bridge ----
// After login, sync account to extension storage so popup can auth.
export async function bridgeAccountToExtension(
  accountId: string,
  email: string,
  totpSecret: string
): Promise<void> {
  // Only runs if extension is installed — detected by chrome.runtime
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
  try {
    const { syncAccountToExtension } = await import('../extension/lib/authBridge')
    await syncAccountToExtension(accountId, email, totpSecret)
  } catch {
    // Extension not installed — silent fail
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
