import { useState } from 'react'
import { useClips } from '../../context/ClipContext'
import { useAuth } from '../../context/AuthContext'
import type { Space } from '@shared/types'

interface Props {
  spaces: Space[]
}

export function SpaceList({ spaces }: Props) {
  const { activeSpaceId, setActiveSpace } = useClips()
  const { activeAccount }                 = useAuth()
  const [creating, setCreating]           = useState(false)
  const [spaceName, setSpaceName]         = useState('')

  const handleCreate = async () => {
    if (!spaceName.trim() || !activeAccount) return
    // Space creation handled by parent — emit event
    const event = new CustomEvent('clipord:create-space', {
      detail: { name: spaceName.trim() }
    })
    window.dispatchEvent(event)
    setSpaceName('')
    setCreating(false)
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setActiveSpace(null)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors
          ${activeSpaceId === null
            ? 'bg-clipord-600/20 text-clipord-300'
            : 'text-white/50 hover:bg-dark-200 hover:text-white/70'}`}
      >
        <span>🔒</span>
        <span className="font-medium">Personal</span>
      </button>

      {spaces.map((space) => (
        <button
          key={space.id}
          onClick={() => setActiveSpace(space.id)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors
            ${activeSpaceId === space.id
              ? 'bg-clipord-600/20 text-clipord-300'
              : 'text-white/50 hover:bg-dark-200 hover:text-white/70'}`}
        >
          <span>👥</span>
          <span className="font-medium truncate">{space.name}</span>
        </button>
      ))}

      {creating ? (
        <div className="px-1 pt-1">
          <input
            type="text"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
            placeholder="Space name..."
            className="input-field text-sm py-2 mb-2"
            autoFocus
            maxLength={40}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!spaceName.trim()} className="flex-1 btn-primary py-1.5 text-xs">
              Create
            </button>
            <button onClick={() => setCreating(false)} className="btn-ghost py-1.5 px-3 text-xs text-white/40">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/30 hover:text-white/50 hover:bg-dark-200 transition-colors"
        >
          <span>+</span>
          <span>New space</span>
        </button>
      )}
    </div>
  )
}
