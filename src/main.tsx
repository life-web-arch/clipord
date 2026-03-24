import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

// ---- PWA Install prompt ----
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let _installPrompt: BeforeInstallPromptEvent | null = null

export function getInstallPrompt(): BeforeInstallPromptEvent | null { return _installPrompt }
export function clearInstallPrompt(): void { _installPrompt = null }

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
      .catch(console.error)
  })
}

// ---- Extension auth bridge ----
export function bridgeAccountToExtension(
  accountId: string,
  email: string,
  totpSecret: string,
  sbSession?: any
): void {
  window.dispatchEvent(new CustomEvent('clipord:sync-account', {
    detail: { 
      accountId, 
      email, 
      totpSecret, 
      sbSession: {
        session: sbSession,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
      } 
    }
  }))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
