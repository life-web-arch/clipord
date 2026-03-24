import { useState, useEffect } from 'react'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { Spinner } from '../ui/Spinner'

interface Props {
  email:      string
  accountId:  string
  onComplete: (secret: string) => void
}

export function TOTPSetup({ email, accountId, onComplete }: Props) {
  const [secret, setSecret]   = useState('')
  const [qrUrl, setQrUrl]     = useState('')
  const [code, setCode]       = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    const totp = new OTPAuth.TOTP({
      issuer:    'Clipord',
      label:     email,
      algorithm: 'SHA1',
      digits:    6,
      period:    30,
      secret:    OTPAuth.Secret.generate(32),
    })
    const secretStr = totp.secret.base32
    setSecret(secretStr)
    QRCode.toDataURL(totp.toString()).then(setQrUrl).catch(console.error)
  }, [email])

  const handleVerify = async () => {
    setLoading(true)
    setError(null)
    const totp = new OTPAuth.TOTP({
      issuer:    'Clipord',
      label:     email,
      algorithm: 'SHA1',
      digits:    6,
      period:    30,
      secret:    OTPAuth.Secret.fromBase32(secret),
    })
    const delta = totp.validate({ token: code, window: 1 })
    if (delta === null) {
      setError('Invalid code. Make sure your authenticator app time is correct.')
    } else {
      // Store plaintext copy for the browser extension popup (which cannot
      // derive the PBKDF2 account key needed to decrypt the encrypted copy).
      // The main app will also encrypt this secret via storeTOTPSecret in
      // App.tsx › handleTOTPSetupComplete.
      localStorage.setItem(`clipord_totp_${accountId}`, secret)
      onComplete(secret)
    }
    setLoading(false)
  }

  const handleCopySecret = async () => {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom overflow-y-auto">
      <div className="w-full max-w-sm py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">Set up authenticator</h2>
          <p className="text-white/40 text-sm mt-2">
            Scan this QR code with Google Authenticator, Authy, or any TOTP app
          </p>
        </div>

        {qrUrl && (
          <div className="bg-white rounded-2xl p-4 mb-4 flex items-center justify-center">
            <img src={qrUrl} alt="TOTP QR Code" className="w-48 h-48" />
          </div>
        )}

        <div className="card mb-6">
          <p className="text-white/40 text-xs mb-2">Or enter this key manually</p>
          <div className="flex items-center gap-2">
            <code className="text-clipord-300 font-mono text-sm flex-1 break-all">{secret}</code>
            <button
              onClick={handleCopySecret}
              className="text-xs text-white/40 hover:text-white/60 flex-shrink-0 px-2 py-1 rounded-lg hover:bg-dark-200 transition-colors"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <p className="text-white/40 text-sm mb-3">Enter the 6-digit code from your app to confirm</p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          placeholder="000000"
          className="input-field mb-4 text-center text-xl tracking-widest font-mono"
          inputMode="numeric"
          maxLength={6}
          autoFocus
        />

        <button
          onClick={handleVerify}
          disabled={loading || code.length < 6}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? <Spinner size="sm" /> : 'Verify & continue'}
        </button>
      </div>
    </div>
  )
}
