import { useState } from 'react'
import { useClipboardDetector } from '../../hooks/useClipboard'
import { useClips } from '../../context/ClipContext'
import { getClipTypeIcon, getClipTypeLabel } from '@shared/detector'
import { Spinner } from '../ui/Spinner'

export function AddClip() {
  const { saveClip, activeSpaceId } = useClips()
  const { detected, dismiss }       = useClipboardDetector(true)
  const [saving, setSaving]         = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualText, setManualText] = useState('')

  const handleSave = async (content: string) => {
    setSaving(true)
    await saveClip(content, activeSpaceId)
    dismiss()
    setSaving(false)
  }

  const handleManualSave = async () => {
    if (!manualText.trim()) return
    setSaving(true)
    await saveClip(manualText.trim(), activeSpaceId)
    setManualText('')
    setManualMode(false)
    setSaving(false)
  }

  return (
    <div>
      {detected && !manualMode && (
        <div className="card border-clipord-500/30 bg-clipord-950/50 mb-4 animate-slide-down">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-lg">{getClipTypeIcon(detected.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-clipord-400 font-medium mb-1">
                {getClipTypeLabel(detected.type)} detected
              </p>
              <p className="text-white/70 text-sm break-all line-clamp-2">{detected.preview}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(detected.content)}
              disabled={saving}
              className="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : '+ Save clip'}
            </button>
            <button
              onClick={dismiss}
              className="btn-ghost py-2 px-4 text-sm text-white/40"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {manualMode ? (
        <div className="card mb-4 animate-slide-down">
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Paste or type content..."
            className="input-field resize-none h-24 mb-3 text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleManualSave}
              disabled={saving || !manualText.trim()}
              className="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : 'Save'}
            </button>
            <button
              onClick={() => { setManualMode(false); setManualText('') }}
              className="btn-ghost py-2 px-4 text-sm text-white/40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setManualMode(true)}
          className="w-full py-2.5 rounded-xl border border-dashed border-dark-300 text-white/30 text-sm hover:border-clipord-500/40 hover:text-clipord-400 transition-colors mb-4"
        >
          + Add clip manually
        </button>
      )}
    </div>
  )
}
