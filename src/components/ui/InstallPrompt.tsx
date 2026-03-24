import { useState, useEffect } from 'react'
import { isIOS, isPWA } from '@shared/platform'

export function InstallPrompt() {
  const [showPrompt, setShowPrompt]     = useState(false)
  const [isIOSDevice, setIsIOSDevice]   = useState(false)
  const [dismissed, setDismissed]       = useState(false)

  useEffect(() => {
    // Don't show if already installed as PWA
    if (isPWA()) return
    // Don't show if dismissed this session
    if (sessionStorage.getItem('clipord_install_dismissed')) return

    const ios = isIOS()
    setIsIOSDevice(ios)

    if (ios) {
      // iOS: always show install instructions (no beforeinstallprompt on iOS)
      setTimeout(() => setShowPrompt(true), 3000)
    } else {
      // Android/Desktop: show when install event fires
      const handler = () => setShowPrompt(true)
      window.addEventListener('clipord:install-available', handler)
      return () => window.removeEventListener('clipord:install-available', handler)
    }
  }, [])

  const handleInstall = async () => {
    const { getInstallPrompt, clearInstallPrompt } = await import('../../main')
    const prompt = getInstallPrompt()
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      clearInstallPrompt()
      setShowPrompt(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    setShowPrompt(false)
    sessionStorage.setItem('clipord_install_dismissed', '1')
  }

  if (!showPrompt || dismissed) return null

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
                Tap <span className="text-clipord-400">Share</span> then{' '}
                <span className="text-clipord-400">Add to Home Screen</span> for the best experience
              </p>
            ) : (
              <p className="text-white/50 text-xs mt-1">
                Add to your home screen for instant access and offline support
              </p>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/30 hover:text-white/60 text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>
        {!isIOSDevice && (
          <button
            onClick={handleInstall}
            className="btn-primary w-full mt-3 text-sm py-2"
          >
            Install app
          </button>
        )}
      </div>
    </div>
  )
}
