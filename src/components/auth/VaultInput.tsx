import { useState } from 'react'
import { importVaultKey } from '@shared/crypto'

interface Props {
  onComplete: (keyB64: string) => void
  onBack: () => void
}

export function VaultInput({ onComplete, onBack }: Props) {
  const [keyStr, setKeyStr] = useState('')
  const[error, setError] = useState<string | null>(null)

  const handleVerify = async () => {
    try {
      await importVaultKey(keyStr.trim())
      onComplete(keyStr.trim())
    } catch {
      setError('Invalid recovery key format')
    }
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="text-white/40 text-sm mb-6">← Back</button>
        <h2 className="text-2xl font-bold text-white mb-2">Enter Recovery Key</h2>
        <p className="text-white/40 text-sm mb-6">
          Enter the master encryption key you saved during setup to decrypt your vault on this device.
        </p>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <textarea
          value={keyStr}
          onChange={e => setKeyStr(e.target.value)}
          className="input-field mb-4 h-24 resize-none font-mono text-sm break-all"
          placeholder="Paste your base64 recovery key here..."
          autoFocus
        />
        <button onClick={handleVerify} disabled={!keyStr.trim()} className="btn-primary w-full py-3">
          Unlock Vault
        </button>
      </div>
    </div>
  )
}
