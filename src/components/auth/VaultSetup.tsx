import { useState, useEffect } from 'react'
import { generateVaultKey, exportVaultKey } from '@shared/crypto'

interface Props {
  onComplete: (keyB64: string) => void
}

export function VaultSetup({ onComplete }: Props) {
  const [keyStr, setKeyStr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    generateVaultKey().then(exportVaultKey).then(setKeyStr)
  },[])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(keyStr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom overflow-y-auto">
      <div className="w-full max-w-sm py-8 text-center">
        <div className="text-5xl mb-4">🔐</div>
        <h2 className="text-2xl font-bold text-white mb-2">Save your Recovery Key</h2>
        <p className="text-white/40 text-sm mb-6">
          This is your master end-to-end encryption key. We <b>never</b> store it. If you lose it, you will lose access to all your synced clips.
        </p>
        <div className="card mb-6">
          <code className="text-clipord-300 font-mono text-sm break-all select-all">{keyStr}</code>
          <button onClick={handleCopy} className="block w-full mt-3 text-xs bg-dark-200 px-3 py-2 rounded-xl text-white/70 hover:bg-dark-300 transition-colors">
            {copied ? '✓ Copied!' : 'Copy Key'}
          </button>
        </div>
        <button onClick={() => onComplete(keyStr)} disabled={!keyStr} className="btn-primary w-full py-3">
          I have securely saved it
        </button>
      </div>
    </div>
  )
}
