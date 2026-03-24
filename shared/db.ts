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
  try {
    const all = await db.clips.where({ accountId }).toArray()
    const filtered = all.filter((c) =>
      spaceId === null ? c.spaceId === null : c.spaceId === spaceId
    )
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.createdAt.localeCompare(a.createdAt)
    })
  } catch (error) {
    console.error("DB: Failed to get clips", error)
    return[]
  }
}

export async function searchClips(
  accountId: string,
  query: string
): Promise<Clip[]> {
  try {
    const all = await db.clips.where({ accountId }).toArray()
    const q   = query.toLowerCase()
    return all.filter(
      (c) =>
        c.preview.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    )
  } catch (error) {
    console.error("DB: Search failed", error)
    return[]
  }
}

export async function upsertClip(clip: Clip): Promise<void> {
  await db.clips.put(clip).catch(err => console.error("DB: Failed to upsert clip", err))
}

export async function deleteClip(id: string): Promise<void> {
  await db.clips.delete(id).catch(err => console.error("DB: Failed to delete clip", err))
}

export async function getExpiredClips(): Promise<Clip[]> {
  try {
    const now = new Date().toISOString()
    const all = await db.clips.toArray()
    return all.filter((c) => c.wipeAt && c.wipeAt <= now)
  } catch (error) {
    console.error("DB: Failed to get expired clips", error)
    return[]
  }
}

// ---- Device settings ----

export async function getDeviceSettings(
  accountId: string,
  deviceId: string
): Promise<DeviceSettings | undefined> {
  return db.deviceSettings.get([accountId, deviceId]).catch(() => undefined)
}

export async function upsertDeviceSettings(settings: DeviceSettings): Promise<void> {
  await db.deviceSettings.put(settings).catch(err => console.error("DB: Failed to upsert settings", err))
}

// ---- Spaces ----

export async function getSpacesForAccount(accountId: string): Promise<Space[]> {
  try {
    const memberships = await db.spaceMembers.where({ accountId }).toArray()
    const spaceIds    = memberships.map((m) => m.spaceId)
    if (spaceIds.length === 0) return[]
    return db.spaces.where('id').anyOf(spaceIds).toArray()
  } catch (error) {
    console.error("DB: Failed to get spaces", error)
    return[]
  }
}

export async function upsertSpace(space: Space): Promise<void> {
  await db.spaces.put(space).catch(err => console.error("DB: Failed to upsert space", err))
}

// ---- Sync queue ----

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id'>): Promise<void> {
  await db.syncQueue.add({ ...item, id: crypto.randomUUID() })
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('createdAt').toArray().catch(() =>[])
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  await db.syncQueue.delete(id).catch(err => console.error("DB: Failed to remove sync queue item", err))
}

// ---- Cache wipe ----

export async function wipeAccountCache(accountId: string): Promise<void> {
  try {
    await db.transaction('rw', db.clips, db.pendingClips, db.spaceMembers, db.spaces, async () => {
      await db.clips.where({ accountId }).delete()
      await db.pendingClips.where({ accountId }).delete()
      await db.spaceMembers.where({ accountId }).delete()
      await db.spaces.where({ creatorId: accountId }).delete()
    })
  } catch (error) {
    console.error("DB: Failed to wipe account cache", error)
  }
}

// ---- Camel ↔ Snake helpers ----

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
