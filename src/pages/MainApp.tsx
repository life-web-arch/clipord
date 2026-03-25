import { useState, useEffect, useCallback } from 'react'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { ClipList } from '../components/clips/ClipList'
import { AddClip } from '../components/clips/AddClip'
import { SearchBar } from '../components/clips/SearchBar'
import { InstallPrompt } from '../components/ui/InstallPrompt'
import { useSync } from '../hooks/useSync'
import type { Clip } from '@shared/types'

export function MainApp() {
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [searchMode, setSearchMode]       = useState(false)
  const [searchResults, setSearchResults] = useState<Clip[] | null>(null)
  const [isOffline, setIsOffline]         = useState(!navigator.onLine)

  useSync()

  useEffect(() => {
    const onOnline  = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  },[])

  const handleSearchResults = useCallback((results: Clip[] | null) => {
    setSearchResults(results)
  },[])

  return (
    <div className="min-h-screen bg-dark-0">
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500/20 border-b border-yellow-500/30 px-4 py-1.5 text-center">
          <p className="text-yellow-300 text-xs font-medium">Offline — changes will sync when connected</p>
        </div>
      )}

      <Header onMenuClick={() => setSidebarOpen(true)} onSearchFocus={() => setSearchMode(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className={`max-w-2xl mx-auto px-4 py-4 safe-bottom ${isOffline ? 'mt-7' : ''}`}>
        {searchMode && (
          <div className="mb-4 animate-slide-down">
            <SearchBar onResults={handleSearchResults} />
            {searchResults === null && (
              <button onClick={() => { setSearchMode(false); setSearchResults(null) }} className="text-white/30 text-xs mt-2 hover:text-white/50">
                Cancel search
              </button>
            )}
          </div>
        )}

        {!searchMode && <AddClip />}
        <ClipList />
      </main>

      <InstallPrompt />
    </div>
  )
}
