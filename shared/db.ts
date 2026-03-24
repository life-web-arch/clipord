import Dexie, { type Table } from 'dexie'
import type {
  Clip,
  Space,
  SpaceMember,
  SpaceInvite,
  DeviceSettings,
  SyncQueueItem,
  PendingClip,
} from './types'

export class CliportDB extends Dexie {
  clips!:          Table<Clip>
  spaces!:         Table<Space>
  spaceMembers!:   Table<SpaceMember>
  spaceInvites!:   Table<SpaceInvite>
  deviceSettings!: Table<DeviceSettings>
  syncQueue!:      Table<SyncQueueItem>
  pendingClips!:   Table<PendingClip>

  constructor() {
    super('clipord')
    this.version(1).stores({
      // IMPORTANT: Use plain `id` not `++id` — we use string UUIDs, not auto-increment integers.
      clips:          'id, accountId, spaceId, type, pinned, createdAt, wipeAt, synced',
      spaces:         'id, creatorId, createdAt',
      spaceMembers:   '[spaceId+accountId], spaceId, accountId, role',
      spaceInvites:   'id, spaceId, token, expiresAt, usedAt, approved',
      deviceSettings: '[accountId+deviceId], accountId',
      syncQueue:      'id, operation, table, createdAt',
      pendingClips:   'id, accountId, createdAt',
    })
  }
}

export const db = new CliportDB()

// ---- Clips ----

export async function getClipsForAccount(
  accountId: string,
  spaceId: string | null = null
): Promise<Clip[]> {
  const all = await db.clips.where({ accountId }).toArray()
  const filtered = all.filter((c) =>
    spaceId === null ? c.spaceId === null : c.spaceId === spaceId
  )
  return filtered.sort((a, b) => {
    // Pinned first, then newest first
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export async function searchClips(
  accountId: string,
  query: string
): Promise<Clip[]> {
  const all = await db.clips.where({ accountId }).toArray()
  const q   = query.toLowerCase()
  return all.filter(
    (c) =>
      c.preview.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q))
  )
}

export async function upsertClip(clip: Clip): Promise<void> {
  await db.clips.put(clip)
}

export async function deleteClip(id: string): Promise<void> {
  await db.clips.delete(id)
}

export async function getExpiredClips(): Promise<Clip[]> {
  const now = new Date().toISOString()
  const all = await db.clips.toArray()
  return all.filter((c) => c.wipeAt && c.wipeAt <= now)
}

// ---- Device settings ----

export async function getDeviceSettings(
  accountId: string,
  deviceId: string
): Promise<DeviceSettings | undefined> {
  return db.deviceSettings.get([accountId, deviceId])
}

export async function upsertDeviceSettings(settings: DeviceSettings): Promise<void> {
  await db.deviceSettings.put(settings)
}

// ---- Spaces ----

export async function getSpacesForAccount(accountId: string): Promise<Space[]> {
  const memberships = await db.spaceMembers.where({ accountId }).toArray()
  const spaceIds    = memberships.map((m) => m.spaceId)
  if (spaceIds.length === 0) return []
  return db.spaces.where('id').anyOf(spaceIds).toArray()
}

export async function upsertSpace(space: Space): Promise<void> {
  await db.spaces.put(space)
}

// ---- Sync queue ----

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id'>): Promise<void> {
  await db.syncQueue.add({ ...item, id: crypto.randomUUID() })
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('createdAt').toArray()
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  await db.syncQueue.delete(id)
}

// ---- Cache wipe ----

export async function wipeAccountCache(accountId: string): Promise<void> {
  await db.clips.where({ accountId }).delete()
  await db.pendingClips.where({ accountId }).delete()
  await db.spaceMembers.where({ accountId }).delete()
  await db.spaces.where({ creatorId: accountId }).delete()
}

// ---- Camel ↔ Snake helpers for Supabase Realtime payloads ----

export function snakeToCamelClip(row: Record<string, unknown>): Clip {
  return {
    id:               row['id'] as string,
    accountId:        row['account_id'] as string,
    spaceId:          (row['space_id'] as string | null) ?? null,
    type:             row['type'] as Clip['type'],
    preview:          row['preview'] as string,
    encryptedContent: row['encrypted_content'] as string,
    iv:               row['iv'] as string,
    pinned:           Boolean(row['pinned']),
    tags:             (row['tags'] as string[]) ?? [],
    wipeAt:           (row['wipe_at'] as string | null) ?? null,
    createdAt:        row['created_at'] as string,
    updatedAt:        row['updated_at'] as string,
    synced:           true,
  }
}

export function camelToSnakeClip(clip: Clip): Record<string, unknown> {
  return {
    id:               clip.id,
    account_id:       clip.accountId,
    space_id:         clip.spaceId,
    type:             clip.type,
    preview:          clip.preview,
    encrypted_content: clip.encryptedContent,
    iv:               clip.iv,
    pinned:           clip.pinned,
    tags:             clip.tags,
    wipe_at:          clip.wipeAt,
    created_at:       clip.createdAt,
    updated_at:       clip.updatedAt,
  }
}
