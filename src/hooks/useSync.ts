import { useEffect, useCallback, useRef } from 'react'
import { supabase, subscribeToClips } from '@shared/supabase'
import { upsertClip, getPendingSyncItems, removeSyncQueueItem } from '@shared/db'
import { useAuth } from '../context/AuthContext'
import { useClips } from '../context/ClipContext'
import type { Clip } from '@shared/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function useSync() {
  const { activeAccount } = useAuth()
  const { activeSpaceId, refreshClips } = useClips()
  const channelRef = useRef<RealtimeChannel | null>(null)
  const isSyncingRef = useRef(false)

  const processSyncQueue = useCallback(async () => {
    // Prevent overlapping sync processes
    if (isSyncingRef.current || !navigator.onLine) return
    isSyncingRef.current = true

    try {
      const items = await getPendingSyncItems()
      for (const item of items) {
        try {
          if (item.operation === 'insert' || item.operation === 'update') {
            await supabase.from(item.table).upsert(item.payload)
          } else if (item.operation === 'delete') {
            await supabase.from(item.table).delete().eq('id', item.payload.id)
          }
          await removeSyncQueueItem(item.id)
        } catch (err) {
          console.warn('Individual sync item failed, will retry:', err)
          // Break out of loop to preserve chronological order on failures
          break
        }
      }
    } finally {
      isSyncingRef.current = false
    }
  },[])

  useEffect(() => {
    if (!activeAccount) return

    const handleNewClip = async (raw: Record<string, unknown>) => {
      const clip = raw as unknown as Clip
      await upsertClip({ ...clip, synced: true })
      await refreshClips()
    }

    const handleDeleteClip = async (clipId: string) => {
      const { deleteClip } = await import('@shared/db')
      await deleteClip(clipId)
      await refreshClips()
    }

    channelRef.current = subscribeToClips(
      activeAccount.id,
      activeSpaceId,
      handleNewClip,
      handleDeleteClip
    )

    return () => {
      channelRef.current?.unsubscribe()
    }
  },[activeAccount, activeSpaceId, refreshClips])

  useEffect(() => {
    // Throttled online listener
    let syncTimeout: ReturnType<typeof setTimeout>
    const onOnline = () => {
      clearTimeout(syncTimeout)
      syncTimeout = setTimeout(processSyncQueue, 1000)
    }
    
    window.addEventListener('online', onOnline)
    if (navigator.onLine) processSyncQueue()
    
    return () => {
      window.removeEventListener('online', onOnline)
      clearTimeout(syncTimeout)
    }
  }, [processSyncQueue])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SYNC_REQUESTED') processSyncQueue()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  },[processSyncQueue])
}
