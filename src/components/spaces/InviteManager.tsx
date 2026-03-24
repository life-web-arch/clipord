import { useState } from 'react'
import { supabase } from '@shared/supabase'
import { useAuth } from '../../context/AuthContext'
import { Spinner } from '../ui/Spinner'

interface Props {
  spaceId:    string
  spaceName:  string
  isCreator:  boolean
}

export function InviteManager({ spaceId, spaceName, isCreator }: Props) {
  const { activeAccount }           = useAuth()
  const [inviteUrl, setInviteUrl]   = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [copied, setCopied]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const generateInvite = async () => {
    if (!activeAccount) return
    setLoading(true)
    setError(null)
    const token     = crypto.randomUUID().replace(/-/g, '')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { error: err } = await supabase.from('space_invites').insert({
      id:         crypto.randomUUID(),
      space_id:   spaceId,
      created_by: activeAccount.id,
      token,
      expires_at: expiresAt,
      approved:   isCreator,
    })
    if (err) {
      setError(err.message)
    } else {
      const url = `${import.meta.env.VITE_APP_URL}/invite/${token}`
      setInviteUrl(url)
    }
    setLoading(false)
  }

  const handleCopy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold mb-1">Invite to {spaceName}</h3>
        <p className="text-white/40 text-xs">
          {isCreator
            ? 'Generate a one-time invite link. It expires in 24 hours and can only be used once.'
            : 'Generate a link — the space creator will need to approve it first.'}
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {inviteUrl ? (
        <div className="card">
          <p className="text-white/40 text-xs mb-2">Share this link — it works once, for 24 hours</p>
          <p className="text-white/70 text-xs font-mono break-all mb-3">{inviteUrl}</p>
          <button
            onClick={handleCopy}
            className={`w-full py-2 rounded-xl text-sm font-medium transition-all
              ${copied ? 'bg-green-500/20 text-green-400' : 'btn-primary'}`}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
          <button
            onClick={() => { setInviteUrl(null) }}
            className="w-full mt-2 py-2 text-sm text-white/30 hover:text-white/50"
          >
            Generate new link
          </button>
        </div>
      ) : (
        <button
          onClick={generateInvite}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? <Spinner size="sm" /> : '🔗 Generate invite link'}
        </button>
      )}
    </div>
  )
}
