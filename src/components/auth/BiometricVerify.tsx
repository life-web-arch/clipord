import { useState, useEffect } from 'react'
import { useBiometric } from '../../hooks/useBiometric'
import { Spinner } from '../ui/Spinner'

interface Props {
  accountId:   string
  email:       string
  onVerified:  () => void
  onFallback:  () => void
  onForgot:    () => void
}

export function BiometricVerify({ accountId, email, onVerified, onFallback, onForgot }: Props) {
  const { verify } = useBiometric()
  const [loading, setLoading]   = useState(false)
  const[error, setError]       = useState<string | null>(null)
  const [notRegistered, setNotRegistered] = useState(false)

  const handleBiometric = async () => {
    setLoading(true)
    setError(null)
    
    // Check if the credential actually exists locally before invoking
    const isReg = localStorage.getItem(`clipord_webauthn_${accountId}`)
    if (!isReg) {
      setNotRegistered(true)
      setError('Biometrics not set up on this device. Please use your authenticator code.')
      setLoading(false)
      return
    }

    const success = await verify(accountId)
    if (success) {
      onVerified()
    } else {
      setError('Biometric verification failed. Please try again or use your code.')
    }
    setLoading(false)
  }

  useEffect(() => { handleBiometric() },[])

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm text-center">
        <div className="flex flex-col items-center mb-10">
          <div
            onClick={notRegistered ? onFallback : handleBiometric}
            className="w-24 h-24 bg-clipord-600/20 border-2 border-clipord-600/40 rounded-3xl flex items-center justify-center mb-6 cursor-pointer hover:bg-clipord-600/30 transition-colors active:scale-95"
          >
            {loading
              ? <Spinner size="lg" />
              : <span className="text-4xl">{notRegistered ? '🔑' : '👆'}</span>}
          </div>
          <h2 className="text-2xl font-bold text-white">
            {notRegistered ? 'Use authenticator' : 'Use biometrics'}
          </h2>
          <p className="text-white/40 text-sm mt-2">{email}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-6 flex flex-col gap-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!notRegistered && (
          <p className="text-white/30 text-sm mb-6">
            Tap the icon to use Face ID / Fingerprint
          </p>
        )}

        <button
          onClick={onFallback}
          className="w-full btn-primary py-2.5 mb-3"
        >
          Use authenticator code instead
        </button>

        <button
          onClick={onForgot}
          className="w-full text-white/20 text-sm hover:text-white/40 transition-colors py-2"
        >
          Can't get in?
        </button>
      </div>
    </div>
  )
}
