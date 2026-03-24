import { useState, useCallback } from 'react'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { ClipList } from '../components/clips/ClipList'
import { AddClip } from '../components/clips/AddClip'
import { SearchBar } from '../components/clips/SearchBar'
import { useSync } from '../hooks/useSync'
import type { Clip } from '@shared/types'

export function MainApp() {
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [searchMode, setSearchMode]     = useState(false)
  const [searchResults, setSearchResults] = useState<Clip[] | null>(null)

  useSync()

  const handleSearchResults = useCallback((results: Clip[] | null) => {
    setSearchResults(results)
  }, [])

  return (
    <div className="min-h-screen bg-dark-0">
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onSearchFocus={() => setSearchMode(true)}
      />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="max-w-2xl mx-auto px-4 py-4 safe-bottom">
        {searchMode && (
          <div className="mb-4 animate-slide-down">
            <SearchBar onResults={handleSearchResults} />
            {searchResults === null && (
              <button
                onClick={() => { setSearchMode(false); setSearchResults(null) }}
                className="text-white/30 text-xs mt-2 hover:text-white/50"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {!searchMode && <AddClip />}

        <ClipList />
      </main>
    </div>
  )
}
