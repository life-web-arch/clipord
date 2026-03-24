import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  db,
  getClipsForAccount,
  upsertClip,
  deleteClip,
  addToSyncQueue,
  getPendingSyncItems,
  removeSyncQueueItem,
  getExpiredClips,
  upsertSpace,
  snakeToCamelClip,
  camelToSnakeClip,
} from '@shared/db'
import { encryptText, decryptText, generateSpaceKey, encryptSpaceKey } from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import {
  supabase,
  subscribeToClips,
  subscribeToSpaces,
  getSpacesWithKeys,
  createSpaceInSupabase,
  upsertClipRemote,
  deleteClipRemote,
} from '@shared/supabase'
import type { Clip, Space } from '@shared/types'
import { useAuth } from './AuthContext'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface ClipContextValue {
  clips:           Clip[]
  spaces:          Space[]
  activeSpaceId:   string | null
  isLoading:       boolean
  highlightedClipId: string | null
  setActiveSpace:  (spaceId: string | null) => void
  saveClip:        (content: string, spaceId?: string | null) => Promise<void>
  removeClip:      (clipId: string) => Promise<void>
  pinClip:         (clipId: string, pinned: boolean) => Promise<void>
  tagClip:         (clipId: string, tags: string[]) => Promise<void>
  setWipeTimer:    (clipId: string, wipeAt: string | null) => Promise<void>
  decryptClip:     (clip: Clip) => Promise<string>
  refreshClips:    () => Promise<void>
  createSpace:     (name: string) => Promise<void>
}

const ClipContext = createContext<ClipContextValue | null>(null)

export function ClipProvider({ children }: { children: React.ReactNode }) {
  const { activeAccount, cryptoKeys, setCryptoKeys } = useAuth()
  const [clips, setClips]               = useState<Clip[]>([])
  const [spaces, setSpaces]             = useState<Space[]>([])
  const[activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading]       = useState(false)
  const [highlightedClipId, setHighlightedClipId] = useState<string | null>(null)
  
  const channelRef                      = useRef<RealtimeChannel | null>(null)
  const spacesChannelRef                = useRef<RealtimeChannel | null>(null)
  const wipeTimerRef                    = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshClips = useCallback(async () => {
    if (!activeAccount) return
    setIsLoading(true)
    const fetched = await getClipsForAccount(activeAccount.id, activeSpaceId)
    setClips(fetched)
    setIsLoading(false)
  },[activeAccount, activeSpaceId])

  const loadSpaces = useCallback(async () => {
    if (!activeAccount || !cryptoKeys) return
    const { spaces: fetched, spaceKeys } = await getSpacesWithKeys(
      activeAccount.id,
      cryptoKeys.accountKey
    )
    for (const space of fetched) {
      await upsertSpace(space)
    }
    setSpaces(fetched)
    setCryptoKeys({
      accountKey: cryptoKeys.accountKey,
      spaceKeys:  { ...cryptoKeys.spaceKeys, ...spaceKeys },
    })
  }, [activeAccount, cryptoKeys?.accountKey])

  useEffect(() => { refreshClips() }, [refreshClips])
  useEffect(() => { loadSpaces() }, [loadSpaces])

  // Track spaces creation across devices
  useEffect(() => {
    if (!activeAccount) return
    spacesChannelRef.current?.unsubscribe()
    spacesChannelRef.current = subscribeToSpaces(activeAccount.id, () => {
      loadSpaces()
    })
    return () => { spacesChannelRef.current?.unsubscribe() }
  }, [activeAccount, loadSpaces])

  useEffect(() => {
    if (!activeAccount) return
    channelRef.current?.unsubscribe()

    channelRef.current = subscribeToClips(
      activeAccount.id,
      activeSpaceId,
      async (row) => {
        const clip = snakeToCamelClip(row)
        await upsertClip(clip)
        setClips((prev) => {
          const exists = prev.find((c) => c.id === clip.id)
          if (!exists && !document.hasFocus()) {
             // Dispatch generic system notification if not actively in the app
             if ('Notification' in window && Notification.permission === 'granted') {
               new Notification('New clip added', { body: clip.preview, icon: '/icons/icon-192.png' })
             }
          }
          if (exists) return prev.map((c) => c.id === clip.id ? clip : c)
          return [clip, ...prev].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1
            if (!a.pinned && b.pinned) return 1
            return b.createdAt.localeCompare(a.createdAt)
          })
        })
        setHighlightedClipId(clip.id)
        setTimeout(() => setHighlightedClipId(null), 4000)
      },
      async (row) => {
        const clip = snakeToCamelClip(row)
        await upsertClip(clip)
        setClips((prev) => prev.map((c) => c.id === clip.id ? clip : c))
      },
      async (clipId) => {
        await deleteClip(clipId)
        setClips((prev) => prev.filter((c) => c.id !== clipId))
      }
    )

    return () => { channelRef.current?.unsubscribe() }
  }, [activeAccount, activeSpaceId])

  const processSyncQueue = useCallback(async () => {
    if (!navigator.onLine) return
    const items = await getPendingSyncItems()
    for (const item of items) {
      let success = false
      try {
        if (item.operation === 'insert' || item.operation === 'update') {
          const { error } = await upsertClipRemote(item.payload)
          success = !error
        } else if (item.operation === 'delete') {
          const { error } = await deleteClipRemote(item.payload['id'] as string)
          success = !error
        }
      } catch (e) {
        console.warn('Sync error:', e)
      }
      if (success) await removeSyncQueueItem(item.id)
    }
  },[])

  useEffect(() => {
    const onOnline = () => processSyncQueue()
    window.addEventListener('online', onOnline)
    if (navigator.onLine) processSyncQueue()
    return () => window.removeEventListener('online', onOnline)
  }, [processSyncQueue])

  useEffect(() => {
    const checkWipes = async () => {
      const expired = await getExpiredClips()
      for (const clip of expired) {
        await deleteClip(clip.id)
        await deleteClipRemote(clip.id)
        setClips((prev) => prev.filter((c) => c.id !== clip.id))
      }
    }
    checkWipes()
    wipeTimerRef.current = setInterval(checkWipes, 60_000)
    return () => {
      if (wipeTimerRef.current) clearInterval(wipeTimerRef.current)
    }
  },[])

  const saveClip = useCallback(async (content: string, spaceId: string | null = null) => {
    if (!activeAccount || !cryptoKeys) return
    const key = spaceId ? cryptoKeys.spaceKeys[spaceId] : cryptoKeys.accountKey
    if (!key) { console.error('No key for clip'); return }

    const { ciphertext, iv } = await encryptText(content, key)
    const now = new Date().toISOString()
    const clip: Clip = {
      id:               crypto.randomUUID(),
      accountId:        activeAccount.id,
      spaceId:          spaceId ?? null,
      type:             detectClipType(content),
      preview:          generatePreview(content),
      encryptedContent: ciphertext,
      iv,
      pinned:           false,
      tags:[],
      wipeAt:           null,
      createdAt:        now,
      updatedAt:        now,
      synced:           false,
    }

    await upsertClip(clip)
    setClips((prev) => [clip, ...prev])

    await addToSyncQueue({
      operation: 'insert',
      table:     'clips',
      payload:   camelToSnakeClip(clip),
      createdAt: now,
    })

    processSyncQueue()
  },[activeAccount, cryptoKeys, processSyncQueue])

  const removeClip = useCallback(async (clipId: string) => {
    await deleteClip(clipId)
    setClips((prev) => prev.filter((c) => c.id !== clipId))
    await addToSyncQueue({
      operation: 'delete',
      table:     'clips',
      payload:   { id: clipId },
      createdAt: new Date().toISOString(),
    })
    processSyncQueue()
  }, [processSyncQueue])

  const pinClip = useCallback(async (clipId: string, pinned: boolean) => {
    const clip = await db.clips.get(clipId)
    if (!clip) return
    const updated: Clip = { ...clip, pinned, updatedAt: new Date().toISOString() }
    await upsertClip(updated)
    setClips((prev) => prev.map((c) => c.id === clipId ? updated : c))
    await addToSyncQueue({
      operation: 'update',
      table:     'clips',
      payload:   camelToSnakeClip(updated),
      createdAt: new Date().toISOString(),
    })
    processSyncQueue()
  },[processSyncQueue])

  const tagClip = useCallback(async (clipId: string, tags: string[]) => {
    const clip = await db.clips.get(clipId)
    if (!clip) return
    const updated: Clip = { ...clip, tags, updatedAt: new Date().toISOString() }
    await upsertClip(updated)
    setClips((prev) => prev.map((c) => c.id === clipId ? updated : c))
    await addToSyncQueue({
      operation: 'update',
      table:     'clips',
      payload:   camelToSnakeClip(updated),
      createdAt: new Date().toISOString(),
    })
    processSyncQueue()
  }, [processSyncQueue])

  const setWipeTimer = useCallback(async (clipId: string, wipeAt: string | null) => {
    const clip = await db.clips.get(clipId)
    if (!clip) return
    const updated: Clip = { ...clip, wipeAt, updatedAt: new Date().toISOString() }
    await upsertClip(updated)
    setClips((prev) => prev.map((c) => c.id === clipId ? updated : c))
    await addToSyncQueue({
      operation: 'update',
      table:     'clips',
      payload:   camelToSnakeClip(updated),
      createdAt: new Date().toISOString(),
    })
    processSyncQueue()
  }, [processSyncQueue])

  const decryptClip = useCallback(async (clip: Clip): Promise<string> => {
    if (!cryptoKeys) throw new Error('No crypto keys')
    const key = clip.spaceId ? cryptoKeys.spaceKeys[clip.spaceId] : cryptoKeys.accountKey
    if (!key) throw new Error('No key for clip')
    return decryptText(clip.encryptedContent, clip.iv, key)
  }, [cryptoKeys])

  const createSpace = useCallback(async (name: string) => {
    if (!activeAccount || !cryptoKeys) return
    const spaceKey = await generateSpaceKey()
    const { encryptedSpaceKey, iv } = await encryptSpaceKey(spaceKey, cryptoKeys.accountKey)

    const { spaceId, error } = await createSpaceInSupabase(
      name,
      activeAccount.id,
      encryptedSpaceKey,
      iv
    )

    if (error || !spaceId) { console.error('Create space failed:', error); return }

    const space: Space = {
      id:                spaceId,
      name,
      creatorId:         activeAccount.id,
      allowMemberInvite: false,
      encryptedSpaceKey,
      iv,
      createdAt:         new Date().toISOString(),
    }

    await upsertSpace(space)
    setSpaces((prev) => [...prev, space])
    setCryptoKeys({
      accountKey: cryptoKeys.accountKey,
      spaceKeys:  { ...cryptoKeys.spaceKeys, [spaceId]: spaceKey },
    })
  },[activeAccount, cryptoKeys, setCryptoKeys])

  return (
    <ClipContext.Provider value={{
      clips,
      spaces,
      activeSpaceId,
      isLoading,
      highlightedClipId,
      setActiveSpace: setActiveSpaceId,
      saveClip,
      removeClip,
      pinClip,
      tagClip,
      setWipeTimer,
      decryptClip,
      refreshClips,
      createSpace,
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

export function useClipsSafe(): ClipContextValue | null {
  return useContext(ClipContext)
}
