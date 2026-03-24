import { useState } from 'react'
import { getClipTypeIcon, getClipTypeLabel } from '@shared/detector'
import { useCopyToClipboard } from '../../hooks/useClipboard'
import { useClips } from '../../context/ClipContext'
import type { Clip } from '@shared/types'

interface Props {
  clip: Clip
}

export function ClipCard({ clip }: Props) {
  const { removeClip, pinClip, decryptClip } = useClips()
  const { copy, copied }                     = useCopyToClipboard()
  const [expanded, setExpanded]              = useState(false)
  const [fullContent, setFullContent]        = useState<string | null>(null)
  const [loadingContent, setLoadingContent]  = useState(false)
  const [confirmDelete, setConfirmDelete]    = useState(false)

  const handleExpand = async () => {
    if (!expanded && !fullContent) {
      setLoadingContent(true)
      const content = await decryptClip(clip)
      setFullContent(content)
      setLoadingContent(false)
    }
    setExpanded(!expanded)
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const content = fullContent ?? (await decryptClip(clip))
    await copy(content)
  }

  const typeColors: Record<string, string> = {
    url:     'text-blue-400 bg-blue-500/10',
    otp:     'text-yellow-400 bg-yellow-500/10',
    phone:   'text-green-400 bg-green-500/10',
    address: 'text-orange-400 bg-orange-500/10',
    code:    'text-purple-400 bg-purple-500/10',
    text:    'text-white/40 bg-white/5',
  }

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins < 1)    return 'just now'
    if (mins < 60)   return `${mins}m ago`
    if (hours < 24)  return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <div
      className={`card cursor-pointer select-none transition-all duration-150
        ${expanded ? 'bg-dark-100' : 'hover:bg-dark-100 active:bg-dark-200'}
        ${clip.pinned ? 'border-clipord-500/30' : ''}`}
      onClick={handleExpand}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColors[clip.type]}`}>
              {getClipTypeIcon(clip.type)} {getClipTypeLabel(clip.type)}
            </span>
            {clip.pinned && <span className="text-yellow-400 text-xs">📌</span>}
            {clip.wipeAt && (
              <span className="text-red-400 text-xs">
                ⏱ {new Date(clip.wipeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="text-white/20 text-xs ml-auto">{timeAgo(clip.createdAt)}</span>
          </div>

          <p className={`text-white/70 text-sm leading-relaxed break-all
            ${clip.type === 'code' ? 'font-mono text-xs text-purple-300' : ''}
            ${!expanded ? 'line-clamp-2' : ''}`}>
            {expanded && fullContent ? fullContent : clip.preview}
          </p>

          {clip.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {clip.tags.map((tag) => (
                <span key={tag} className="text-xs text-clipord-400 bg-clipord-500/10 px-2 py-0.5 rounded-full">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dark-300 animate-fade-in">
          <button
            onClick={handleCopy}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all
              ${copied
                ? 'bg-green-500/20 text-green-400'
                : 'bg-clipord-600/20 text-clipord-400 hover:bg-clipord-600/30'}`}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); pinClip(clip.id, !clip.pinned) }}
            className="py-2 px-3 rounded-xl text-sm bg-dark-200 hover:bg-dark-300 transition-colors"
            title={clip.pinned ? 'Unpin' : 'Pin'}
          >
            {clip.pinned ? '📌' : '📍'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
            className="py-2 px-3 rounded-xl text-sm bg-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            🗑
          </button>
        </div>
      )}

      {confirmDelete && (
        <div
          className="mt-3 pt-3 border-t border-red-500/20 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-white/50 mb-2">Delete this clip permanently?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-1.5 rounded-lg text-sm text-white/40 bg-dark-200 hover:bg-dark-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => removeClip(clip.id)}
              className="flex-1 py-1.5 rounded-lg text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
