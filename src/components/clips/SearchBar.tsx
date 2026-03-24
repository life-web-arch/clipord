import { useState, useCallback } from 'react'
import { searchClips } from '@shared/db'
import { useAuth } from '../../context/AuthContext'
import type { Clip } from '@shared/types'

interface Props {
  onResults: (clips: Clip[] | null) => void
}

export function SearchBar({ onResults }: Props) {
  const { activeAccount } = useAuth()
  const [query, setQuery] = useState('')

  const handleChange = useCallback(async (value: string) => {
    setQuery(value)
    if (!activeAccount) return
    if (!value.trim()) {
      onResults(null)
      return
    }
    const results = await searchClips(activeAccount.id, value.trim())
    onResults(results)
  }, [activeAccount, onResults])

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
      <input
        type="search"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search clips..."
        className="input-field pl-9 py-2.5 text-sm"
      />
      {query && (
        <button
          onClick={() => { setQuery(''); onResults(null) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50 text-sm"
        >
          ✕
        </button>
      )}
    </div>
  )
}
