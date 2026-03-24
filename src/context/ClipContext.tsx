import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { db, getClipsForAccount, upsertClip, deleteClip } from '@shared/db'
import { decryptText, encryptText } from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import type { Clip, Space } from '@shared/types'
import { useAuth } from './AuthContext'

interface ClipContextValue {
  clips:        Clip[]
  spaces:       Space[]
  activeSpaceId: string | null
  isLoading:    boolean
  setActiveSpace: (spaceId: string | null) => void
  saveClip:     (content: string, spaceId?: string | null) => Promise<void>
  removeClip:   (clipId: string) => Promise<void>
  pinClip:      (clipId: string, pinned: boolean) => Promise<void>
  decryptClip:  (clip: Clip) => Promise<string>
  refreshClips: () => Promise<void>
}

const ClipContext = createContext<ClipContextValue | null>(null)

export function ClipProvider({ children }: { children: React.ReactNode }) {
  const { activeAccount, cryptoKeys } = useAuth()
  const [clips, setClips]             = useState<Clip[]>([])
  const [spaces, setSpaces]           = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading]     = useState(false)

  const refreshClips = useCallback(async () => {
    if (!activeAccount) return
    setIsLoading(true)
    const fetched = await getClipsForAccount(activeAccount.id, activeSpaceId)
    setClips(fetched)
    setIsLoading(false)
  }, [activeAccount, activeSpaceId])

  useEffect(() => { refreshClips() }, [refreshClips])

  const saveClip = useCallback(async (content: string, spaceId: string | null = null) => {
    if (!activeAccount || !cryptoKeys) return
    const key  = spaceId ? cryptoKeys.spaceKeys[spaceId] : cryptoKeys.accountKey
    if (!key) return
    const { ciphertext, iv } = await encryptText(content, key)
    const clip: Clip = {
      id:               crypto.randomUUID(),
      accountId:        activeAccount.id,
      spaceId:          spaceId ?? null,
      type:             detectClipType(content),
      preview:          generatePreview(content),
      encryptedContent: ciphertext,
      iv,
      pinned:           false,
      tags:             [],
      wipeAt:           null,
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
      synced:           false,
    }
    await upsertClip(clip)
    setClips((prev) => [clip, ...prev])
  }, [activeAccount, cryptoKeys])

  const removeClip = useCallback(async (clipId: string) => {
    await deleteClip(clipId)
    setClips((prev) => prev.filter((c) => c.id !== clipId))
  }, [])

  const pinClip = useCallback(async (clipId: string, pinned: boolean) => {
    const clip = await db.clips.get(clipId)
    if (!clip) return
    const updated = { ...clip, pinned, updatedAt: new Date().toISOString() }
    await upsertClip(updated)
    setClips((prev) => prev.map((c) => c.id === clipId ? updated : c))
  }, [])

  const decryptClip = useCallback(async (clip: Clip): Promise<string> => {
    if (!cryptoKeys) throw new Error('No crypto keys')
    const key = clip.spaceId ? cryptoKeys.spaceKeys[clip.spaceId] : cryptoKeys.accountKey
    if (!key) throw new Error('No key for clip')
    return decryptText(clip.encryptedContent, clip.iv, key)
  }, [cryptoKeys])

  return (
    <ClipContext.Provider value={{
      clips,
      spaces,
      activeSpaceId,
      isLoading,
      setActiveSpace: setActiveSpaceId,
      saveClip,
      removeClip,
      pinClip,
      decryptClip,
      refreshClips,
    }}>
      {children}
    </ClipContext.Provider>
  )
}

export function useClips(): ClipContextValue {
  const ctx = useContext(ClipContext)
  if (!ctx) throw new Error('useClips must be used within ClipProvider')
  return ctx
}
