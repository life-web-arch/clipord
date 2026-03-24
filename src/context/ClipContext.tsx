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
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading]       = useState(false)
  const channelRef                      = useRef<RealtimeChannel | null>(null)
  const wipeTimerRef                    = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load clips from local DB
  const refreshClips = useCallback(async () => {
    if (!activeAccount) return
    setIsLoading(true)
    const fetched = await getClipsForAccount(activeAccount.id, activeSpaceId)
    setClips(fetched)
    setIsLoading(false)
  }, [activeAccount, activeSpaceId])

  // Load spaces from Supabase and populate spaceKeys in cryptoKeys
  const loadSpaces = useCallback(async () => {
    if (!activeAccount || !cryptoKeys) return
    const { spaces: fetched, spaceKeys } = await getSpacesWithKeys(
      activeAccount.id,
      cryptoKeys.accountKey
    )
    // Persist spaces locally
    for (const space of fetched) {
      await upsertSpace(space)
    }
    setSpaces(fetched)
    // Merge space keys into crypto keys
    setCryptoKeys({
      accountKey: cryptoKeys.accountKey,
      spaceKeys:  { ...cryptoKeys.spaceKeys, ...spaceKeys },
    })
  }, [activeAccount, cryptoKeys?.accountKey])

  useEffect(() => { refreshClips() }, [refreshClips])
  useEffect(() => { loadSpaces() }, [loadSpaces])

  // Real-time sync
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
          if (exists) return prev.map((c) => c.id === clip.id ? clip : c)
          return [clip, ...prev].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1
            if (!a.pinned && b.pinned) return 1
            return b.createdAt.localeCompare(a.createdAt)
          })
        })
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

  // Offline sync queue processor
  const processSyncQueue = useCallback(async () => {
    if (!navigator.onLine) return
    const items = await getPendingSyncItems()
    for (const item of items) {
      let success = false
      try {
        if (item.operation === 'insert' || item.operation === 'update') {
          const { error } = await upsertClipRemote(item.payload)
          success = !error
          if (error) console.warn('Sync upsert failed:', error)
        } else if (item.operation === 'delete') {
          const { error } = await deleteClipRemote(item.payload['id'] as string)
          success = !error
          if (error) console.warn('Sync delete failed:', error)
        }
      } catch (e) {
        console.warn('Sync error:', e)
      }
      // Only remove from queue if successfully synced
      if (success) await removeSyncQueueItem(item.id)
    }
  }, [])

  useEffect(() => {
    const onOnline = () => processSyncQueue()
    window.addEventListener('online', onOnline)
    if (navigator.onLine) processSyncQueue()
    return () => window.removeEventListener('online', onOnline)
  }, [processSyncQueue])

  // Wipe timer — check every minute for expired clips
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
  }, [])

  // Save clip — local + queue for sync
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
      tags:             [],
      wipeAt:           null,
      createdAt:        now,
      updatedAt:        now,
      synced:           false,
    }

    // Save locally first (optimistic)
    await upsertClip(clip)
    setClips((prev) => [clip, ...prev])

    // Queue for remote sync
    await addToSyncQueue({
      operation: 'insert',
      table:     'clips',
      payload:   camelToSnakeClip(clip),
      createdAt: now,
    })

    // Attempt immediate sync
    processSyncQueue()
  }, [activeAccount, cryptoKeys, processSyncQueue])

  // Remove clip — local + sync
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

  // Pin clip
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
  }, [processSyncQueue])

  // Tag clip
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

  // Set wipe timer
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

  // Decrypt a clip
  const decryptClip = useCallback(async (clip: Clip): Promise<string> => {
    if (!cryptoKeys) throw new Error('No crypto keys')
    const key = clip.spaceId ? cryptoKeys.spaceKeys[clip.spaceId] : cryptoKeys.accountKey
    if (!key) throw new Error('No key for clip')
    return decryptText(clip.encryptedContent, clip.iv, key)
  }, [cryptoKeys])

  // Create a new shared space
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
  }, [activeAccount, cryptoKeys, setCryptoKeys])

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
