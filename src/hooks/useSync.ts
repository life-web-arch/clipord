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

  const processSyncQueue = useCallback(async () => {
    const items = await getPendingSyncItems()
    for (const item of items) {
      try {
        if (item.operation === 'insert' || item.operation === 'update') {
          await supabase.from(item.table).upsert(item.payload)
        } else if (item.operation === 'delete') {
          await supabase.from(item.table).delete().eq('id', item.payload.id)
        }
        await removeSyncQueueItem(item.id)
      } catch {
        // Will retry next sync cycle
      }
    }
  }, [])

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
  }, [activeAccount, activeSpaceId, refreshClips])

  useEffect(() => {
    const onOnline = () => processSyncQueue()
    window.addEventListener('online', onOnline)
    if (navigator.onLine) processSyncQueue()
    return () => window.removeEventListener('online', onOnline)
  }, [processSyncQueue])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SYNC_REQUESTED') processSyncQueue()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [processSyncQueue])
}
