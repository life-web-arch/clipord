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
  clips!:         Table<Clip>
  spaces!:        Table<Space>
  spaceMembers!:  Table<SpaceMember>
  spaceInvites!:  Table<SpaceInvite>
  deviceSettings!:Table<DeviceSettings>
  syncQueue!:     Table<SyncQueueItem>
  pendingClips!:  Table<PendingClip>

  constructor() {
    super('clipord')
    this.version(1).stores({
      clips:          '++id, accountId, spaceId, type, pinned, createdAt, wipeAt, synced',
      spaces:         '++id, creatorId, createdAt',
      spaceMembers:   '[spaceId+accountId], spaceId, accountId, role',
      spaceInvites:   '++id, spaceId, token, expiresAt, usedAt, approved',
      deviceSettings: '[accountId+deviceId], accountId',
      syncQueue:      '++id, operation, table, createdAt',
      pendingClips:   '++id, accountId, createdAt',
    })
  }
}

export const db = new CliportDB()

export async function getClipsForAccount(
  accountId: string,
  spaceId: string | null = null
): Promise<Clip[]> {
  return db.clips
    .where({ accountId, spaceId: spaceId ?? null })
    .reverse()
    .sortBy('createdAt')
}

export async function getPinnedClips(accountId: string): Promise<Clip[]> {
  return db.clips
    .where({ accountId, pinned: 1 as unknown as boolean })
    .reverse()
    .sortBy('createdAt')
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

export async function getDeviceSettings(
  accountId: string,
  deviceId: string
): Promise<DeviceSettings | undefined> {
  return db.deviceSettings.get([accountId, deviceId])
}

export async function upsertDeviceSettings(settings: DeviceSettings): Promise<void> {
  await db.deviceSettings.put(settings)
}

export async function getSpacesForAccount(accountId: string): Promise<Space[]> {
  const memberships = await db.spaceMembers.where({ accountId }).toArray()
  const spaceIds    = memberships.map((m) => m.spaceId)
  return db.spaces.where('id').anyOf(spaceIds).toArray()
}

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id'>): Promise<void> {
  await db.syncQueue.add({ ...item, id: crypto.randomUUID() })
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('createdAt').toArray()
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  await db.syncQueue.delete(id)
}

export async function wipeAccountCache(accountId: string): Promise<void> {
  await db.clips.where({ accountId }).delete()
  await db.pendingClips.where({ accountId }).delete()
  await db.spaceMembers.where({ accountId }).delete()
}
