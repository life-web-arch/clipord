import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import type { Account } from '@shared/types'

interface Props {
  onSelectAccount: (account: Account) => void
  onAddAccount:    () => void
}

export function AccountSwitcher({ onSelectAccount, onAddAccount }: Props) {
  const { accounts, removeAccount } = useAuth()
  const [removing, setRemoving]     = useState<string | null>(null)

  const handleLongPress = (accountId: string) => {
    setRemoving(accountId)
  }

  const handleRemove = async (accountId: string) => {
    await removeAccount(accountId)
    setRemoving(null)
  }

  return (
    <div className="min-h-screen bg-dark-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-clipord-600 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">📋</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Clipord</h1>
          <p className="text-white/40 text-sm mt-1">Choose an account</p>
        </div>

        <div className="space-y-3">
          {accounts.length === 0 && (
            <p className="text-white/30 text-center text-sm py-4">No accounts yet</p>
          )}
          {accounts.map((account) => (
            <div key={account.id} className="relative">
              <button
                onClick={() => onSelectAccount(account)}
                onContextMenu={(e) => { e.preventDefault(); handleLongPress(account.id) }}
                className="w-full card flex items-center gap-4 hover:bg-dark-100 active:bg-dark-200 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-clipord-600/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-clipord-400 font-semibold text-sm">
                    {account.email[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{account.email}</p>
                  <p className="text-white/30 text-xs mt-0.5">Tap to continue</p>
                </div>
                <span className="text-white/20 text-lg">›</span>
              </button>

              {removing === account.id && (
                <div className="absolute inset-0 bg-dark-50 border border-red-500/30 rounded-2xl flex items-center justify-between px-4 animate-fade-in">
                  <p className="text-sm text-white/70">Remove from this device?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRemoving(null)}
                      className="text-xs text-white/50 px-3 py-1.5 rounded-lg hover:bg-dark-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRemove(account.id)}
                      className="text-xs text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={onAddAccount}
            className="w-full card flex items-center gap-4 hover:bg-dark-100 active:bg-dark-200 transition-colors border-dashed border-dark-300"
          >
            <div className="w-10 h-10 bg-dark-200 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white/40 text-xl leading-none">+</span>
            </div>
            <p className="text-white/40 font-medium text-sm">Add another account</p>
          </button>
        </div>
      </div>
    </div>
  )
}
