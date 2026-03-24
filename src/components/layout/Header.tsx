import { useClips } from '../../context/ClipContext'

interface Props {
  onMenuClick:   () => void
  onSearchFocus: () => void
}

export function Header({ onMenuClick, onSearchFocus }: Props) {
  const { activeSpaceId, spaces } = useClips()
  const space = spaces.find((s) => s.id === activeSpaceId)

  return (
    <header className="sticky top-0 z-20 bg-dark-0/90 backdrop-blur-md border-b border-dark-200 safe-top">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onMenuClick}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-dark-200 transition-colors text-white/60 hover:text-white"
          aria-label="Menu"
        >
          ☰
        </button>
        <div className="flex-1">
          <h1 className="text-white font-semibold text-sm">
            {activeSpaceId ? (space?.name ?? 'Space') : 'Personal'}
          </h1>
        </div>
        <button
          onClick={onSearchFocus}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-dark-200 transition-colors text-white/60 hover:text-white"
          aria-label="Search"
        >
          🔍
        </button>
      </div>
    </header>
  )
}
