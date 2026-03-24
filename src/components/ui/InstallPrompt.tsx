import { useState, useEffect, useRef } from 'react'
import { isIOS, isPWA } from '@shared/platform'

export function InstallPrompt() {
  const [show, setShow]           = useState(false)
  const [isIOSDevice, setIsIOS]   = useState(false)
  const hasPrompt                 = useRef(false)

  useEffect(() => {
    if (isPWA()) return
    if (sessionStorage.getItem('clipord_install_dismissed')) return

    const ios = isIOS()
    setIsIOS(ios)

    if (ios) {
      // iOS: always show after 4s (no beforeinstallprompt available)
      const t = setTimeout(() => setShow(true), 4000)
      return () => clearTimeout(t)
    }

    // Use the robust path alias '@/' to prevent build failures
    import('@/main').then(({ getInstallPrompt }) => {
      if (getInstallPrompt()) {
        hasPrompt.current = true
        setShow(true)
      }
    }).catch((e) => console.error("Failed to load install prompt handler", e))

    // Also listen for future fires
    const handler = () => {
      hasPrompt.current = true
      setShow(true)
    }
    window.addEventListener('clipord:install-available', handler)
    return () => window.removeEventListener('clipord:install-available', handler)
  },[])

  const handleInstall = async () => {
    try {
      // Use the robust path alias '@/' here as well
      const { getInstallPrompt, clearInstallPrompt } = await import('@/main')
      const prompt = getInstallPrompt()
      if (!prompt) return
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        clearInstallPrompt()
        setShow(false)
      }
    } catch { /* */ }
  }

  const dismiss = () => {
    setShow(false)
    sessionStorage.setItem('clipord_install_dismissed', '1')
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-dark-100 border border-clipord-500/30 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-clipord-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <span>📋</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">Install Clipord</p>
            {isIOSDevice ? (
              <p className="text-white/50 text-xs mt-1">
                Tap <span className="text-clipord-300">Share ↑</span> then{' '}
                <span className="text-clipord-300">Add to Home Screen</span>
              </p>
            ) : (
              <p className="text-white/50 text-xs mt-1">
                Add to home screen for instant access and offline use
              </p>
            )}
          </div>
          <button
            onClick={dismiss}
            className="text-white/30 hover:text-white/60 text-xl leading-none flex-shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>
        {!isIOSDevice && (
          <button onClick={handleInstall} className="btn-primary w-full mt-3 text-sm py-2">
            Install
          </button>
        )}
      </div>
    </div>
  )
}
