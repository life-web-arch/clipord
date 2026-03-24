import { useState, useEffect } from 'react'
import browser from 'webextension-polyfill'
import { detectClipType, generatePreview, getClipTypeIcon } from '@shared/detector'

interface PendingClip {
  id:        string
  content:   string
  spaceId:   string | null
  accountId: string
  createdAt: string
}

export function Popup() {
  const [clips, setClips]     = useState<PendingClip[]>([])
  const [copied, setCopied]   = useState<string | null>(null)

  useEffect(() => {
    browser.storage.local.get('pending_clips').then((result) => {
      setClips((result.pending_clips as PendingClip[] | undefined) ?? [])
    })
  }, [])

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleDelete = async (id: string) => {
    const updated = clips.filter((c) => c.id !== id)
    await browser.storage.local.set({ pending_clips: updated })
    setClips(updated)
  }

  const openApp = () => {
    const url = 'https://clipord.app'
    browser.tabs.create({ url })
  }

  return (
    <div className="w-80 bg-dark-0 text-white font-sans">
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-200">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <span className="font-bold text-sm">Clipord</span>
        </div>
        <button
          onClick={openApp}
          className="text-xs text-clipord-400 hover:text-clipord-300 transition-colors"
        >
          Open app →
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {clips.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-white/30 text-xs">No clips saved yet</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {clips.slice().reverse().map((clip) => {
              const type    = detectClipType(clip.content)
              const preview = generatePreview(clip.content, 60)
              return (
                <div key={clip.id} className="bg-dark-100 rounded-xl p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-sm flex-shrink-0">{getClipTypeIcon(type)}</span>
                    <p className="text-white/70 text-xs leading-relaxed flex-1 break-all line-clamp-3">
                      {preview}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleCopy(clip.content, clip.id)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${copied === clip.id
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-clipord-600/20 text-clipord-400 hover:bg-clipord-600/30'}`}
                    >
                      {copied === clip.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleDelete(clip.id)}
                      className="py-1.5 px-2 rounded-lg text-xs bg-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
