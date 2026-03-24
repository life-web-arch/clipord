import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import {
  db,
  getClipsForAccount,
  upsertClip,
  deleteClip,
  getSpacesForAccount,
  upsertSpace,
  upsertSpaceMember,
} from '@shared/db'
import {
  decryptText,
  encryptText,
  generateSpaceKey,
  encryptSpaceKey,
  decryptSpaceKey,
} from '@shared/crypto'
import { detectClipType, generatePreview } from '@shared/detector'
import { getSpacesWithKeys, createSpaceInSupabase } from '@shared/supabase'
import type { Clip, Space, CryptoKeys } from '@shared/types'
import { useAuth } from './AuthContext'

interface ClipContextValue {
  clips:          Clip[]
  spaces:         Space[]
  activeSpaceId:  string | null
  isLoading:      boolean
  setActiveSpace: (spaceId: string | null) => void
  saveClip:       (content: string, spaceId?: string | null) => Promise<void>
  removeClip:     (clipId: string) => Promise<void>
  pinClip:        (clipId: string, pinned: boolean) => Promise<void>
  decryptClip:    (clip: Clip) => Promise<string>
  refreshClips:   () => Promise<void>
  createSpace:    (name: string) => Promise<void>
}

const ClipContext = createContext<ClipContextValue | null>(null)

export function ClipProvider({ children }: { children: React.ReactNode }) {
  const { activeAccount, cryptoKeys, setCryptoKeys } = useAuth()
  const [clips, setClips]                 = useState<Clip[]>([])
  const [spaces, setSpaces]               = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading]         = useState(false)

  // ---- Load and decrypt space keys ----
  const loadSpaces = useCallback(async (keys: CryptoKeys) => {
    if (!activeAccount) return keys

    // 1. Try local DB first (offline-first)
    const localSpaces = await getSpacesForAccount(activeAccount.id)

    // 2. Fetch from Supabase (includes encrypted_space_key per membership row)
    let remoteRows: Awaited<ReturnType<typeof getSpacesWithKeys>> = []
    try {
      remoteRows = await getSpacesWithKeys(activeAccount.id)
    } catch {
      // Offline — use local data only
    }

    // 3. Merge remote into local DB and decrypt space keys
    const updatedSpaceKeys: Record<string, CryptoKey> = { ...keys.spaceKeys }

    for (const row of remoteRows) {
      const space: Space = {
        id:                row.id,
        name:              row.name,
        creatorId:         row.creator_id,
        allowMemberInvite: row.allow_member_invite,
        encryptedSpaceKey: row.encrypted_space_key,
        iv:                row.iv,
        createdAt:         row.created_at,
      }
      await upsertSpace(space)

      // Decrypt the space key using the account key
      try {
        const spaceKey = await decryptSpaceKey(
          row.encrypted_space_key,
          row.iv,
          keys.accountKey
        )
        updatedSpaceKeys[row.id] = spaceKey
      } catch {
        console.error(`Failed to decrypt space key for space ${row.id}`)
      }
    }

    const newKeys: CryptoKeys = { accountKey: keys.accountKey, spaceKeys: updatedSpaceKeys }

    // Only call setCryptoKeys if space keys actually changed to avoid loops
    if (Object.keys(updatedSpaceKeys).length !== Object.keys(keys.spaceKeys).length) {
      setCryptoKeys(newKeys)
    }

    // 4. Refresh space list from local DB (now updated)
    const allSpaces = await getSpacesForAccount(activeAccount.id)
    // Merge any local-only spaces that might not be on remote yet
    const merged = allSpaces.length > 0 ? allSpaces : localSpaces
    setSpaces(merged)

    return newKeys
  }, [activeAccount, setCryptoKeys])

  // ---- Load clips ----
  const refreshClips = useCallback(async () => {
    if (!activeAccount) return
    setIsLoading(true)
    const fetched = await getClipsForAccount(activeAccount.id, activeSpaceId)
    setClips(fetched)
    setIsLoading(false)
  }, [activeAccount, activeSpaceId])

  // ---- Bootstrap on account/keys change ----
  useEffect(() => {
    if (!activeAccount || !cryptoKeys) return
    loadSpaces(cryptoKeys).then(() => refreshClips())
  }, [activeAccount, cryptoKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Reload clips when active space changes ----
  useEffect(() => {
    refreshClips()
  }, [refreshClips])

  // ---- Listen for create-space custom event from Sidebar / extension ----
  useEffect(() => {
    const handler = async (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail.name
      if (name) await createSpace(name)
    }
    window.addEventListener('clipord:create-space', handler)
    return () => window.removeEventListener('clipord:create-space', handler)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Save a clip ----
  const saveClip = useCallback(async (content: string, spaceId: string | null = null) => {
    if (!activeAccount || !cryptoKeys) return
    const key = spaceId ? cryptoKeys.spaceKeys[spaceId] : cryptoKeys.accountKey
    if (!key) {
      console.error('No encryption key available for space', spaceId)
      return
    }
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

  // ---- Remove a clip ----
  const removeClip = useCallback(async (clipId: string) => {
    await deleteClip(clipId)
    setClips((prev) => prev.filter((c) => c.id !== clipId))
  }, [])

  // ---- Pin / unpin ----
  const pinClip = useCallback(async (clipId: string, pinned: boolean) => {
    const clip = await db.clips.get(clipId)
    if (!clip) return
    const updated = { ...clip, pinned, updatedAt: new Date().toISOString() }
    await upsertClip(updated)
    setClips((prev) => prev.map((c) => (c.id === clipId ? updated : c)))
  }, [])

  // ---- Decrypt a clip for display / copy ----
  const decryptClip = useCallback(async (clip: Clip): Promise<string> => {
    if (!cryptoKeys) throw new Error('No crypto keys')
    const key = clip.spaceId ? cryptoKeys.spaceKeys[clip.spaceId] : cryptoKeys.accountKey
    if (!key) throw new Error('No key available for this clip')
    return decryptText(clip.encryptedContent, clip.iv, key)
  }, [cryptoKeys])

  // ---- Create a new shared space ----
  const createSpace = useCallback(async (name: string) => {
    if (!activeAccount || !cryptoKeys) return

    // Generate a new random AES key for the space
    const spaceKey = await generateSpaceKey()

    // Encrypt the space key with the account key so it can be stored
    const { encryptedSpaceKey, iv } = await encryptSpaceKey(spaceKey, cryptoKeys.accountKey)

    // Persist to Supabase
    const { spaceId, error } = await createSpaceInSupabase(
      name,
      activeAccount.id,
      encryptedSpaceKey,
      iv
    )
    if (error || !spaceId) {
      console.error('Failed to create space:', error)
      return
    }

    const now = new Date().toISOString()

    // Persist locally
    const space: Space = {
      id:                spaceId,
      name,
      creatorId:         activeAccount.id,
      allowMemberInvite: false,
      encryptedSpaceKey,
      iv,
      createdAt:         now,
    }
    await upsertSpace(space)
    await upsertSpaceMember({
      spaceId,
      accountId:          activeAccount.id,
      role:               'creator',
      encryptedSpaceKey,
      iv,
      joinedAt:           now,
    })

    // Update in-memory space keys
    const newKeys: CryptoKeys = {
      accountKey: cryptoKeys.accountKey,
      spaceKeys:  { ...cryptoKeys.spaceKeys, [spaceId]: spaceKey },
    }
    setCryptoKeys(newKeys)

    setSpaces((prev) => [...prev, space])
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
