import { useEffect } from 'react'
import { useClipsSafe } from '../context/ClipContext'

export function useSync() {
  const clipCtx = useClipsSafe()

  useEffect(() => {
    if (!clipCtx) return

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SYNC_REQUESTED') {
        // Force the ClipContext to refresh/process the queue
        clipCtx.refreshClips()
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  },[clipCtx])
}
