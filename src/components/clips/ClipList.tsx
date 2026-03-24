import { useClips } from '../../context/ClipContext'
import { ClipCard } from './ClipCard'
import { Spinner } from '../ui/Spinner'

export function ClipList() {
  const { clips, isLoading } = useClips()

  const pinned   = clips.filter((c) => c.pinned)
  const unpinned = clips.filter((c) => !c.pinned)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="text-5xl mb-4">📋</div>
        <p className="text-white/40 text-sm">No clips yet</p>
        <p className="text-white/20 text-xs mt-1">Copy something and save it here</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pinned.length > 0 && (
        <div>
          <p className="text-white/30 text-xs font-medium px-1 mb-2 uppercase tracking-wider">Pinned</p>
          <div className="space-y-2">
            {pinned.map((clip) => <ClipCard key={clip.id} clip={clip} />)}
          </div>
        </div>
      )}
      {unpinned.length > 0 && (
        <div>
          {pinned.length > 0 && (
            <p className="text-white/30 text-xs font-medium px-1 mb-2 uppercase tracking-wider">Recent</p>
          )}
          <div className="space-y-2">
            {unpinned.map((clip) => <ClipCard key={clip.id} clip={clip} />)}
          </div>
        </div>
      )}
    </div>
  )
}
