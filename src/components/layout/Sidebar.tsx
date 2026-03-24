import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useClips } from '../../context/ClipContext'
import { SpaceList } from '../spaces/SpaceList'
import { SettingsPage } from '../settings/SettingsPage'

interface Props {
  open:    boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: Props) {
  const { activeAccount } = useAuth()
  const { spaces }        = useClips()
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      {/* Settings overlay */}
      {showSettings && (
        <SettingsPage onClose={() => setShowSettings(false)} />
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed top-0 left-0 h-full w-72 bg-dark-50 border-r border-dark-200
        z-40 flex flex-col transition-transform duration-300 safe-top
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-dark-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-clipord-600 rounded-xl flex items-center justify-center">
              <span className="text-sm">📋</span>
            </div>
            <span className="text-white font-bold">Clipord</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-white/30 text-xs font-medium px-2 mb-2 uppercase tracking-wider">Vaults</p>
          <SpaceList spaces={spaces} />
        </div>

        <div className="p-3 border-t border-dark-200">
          <button
            onClick={() => { setShowSettings(true); onClose() }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-dark-200 cursor-pointer transition-colors"
          >
            <div className="w-8 h-8 bg-clipord-600/30 rounded-xl flex items-center justify-center">
              <span className="text-clipord-400 font-semibold text-sm">
                {activeAccount?.email[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-white text-sm font-medium truncate">{activeAccount?.email}</p>
              <p className="text-white/30 text-xs">Settings</p>
            </div>
            <span className="text-white/20 text-sm">⚙</span>
          </button>
        </div>
      </aside>
    </>
  )
}
