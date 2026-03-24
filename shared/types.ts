export type ClipType = 'url' | 'otp' | 'phone' | 'address' | 'code' | 'text'
export type SpaceRole = 'creator' | 'member'
export type VerificationMethod = 'biometric' | 'totp' | 'both'
export type NotificationTrigger =
  | 'clip_saved_personal'
  | 'clip_added_space'
  | 'invite_accepted'
  | 'invite_pending'
  | 'invite_approved'
  | 'invite_rejected'
  | 'member_joined'

export interface Account {
  id:        string
  email:     string
  createdAt: string
}

export interface DeviceSettings {
  accountId:           string
  deviceId:            string
  verificationEnabled: boolean
  verificationMethod:  VerificationMethod
  cacheWipeAfterDays:  number | null
  lastActiveAt:        string
}

export interface Clip {
  id:               string
  accountId:        string
  spaceId:          string | null
  type:             ClipType
  preview:          string
  encryptedContent: string
  iv:               string
  pinned:           boolean
  tags:             string[]
  wipeAt:           string | null
  createdAt:        string
  updatedAt:        string
  synced:           boolean
}

export interface Space {
  id:                string
  name:              string
  creatorId:         string
  allowMemberInvite: boolean
  encryptedSpaceKey: string
  iv:                string
  createdAt:         string
}

export interface SpaceMember {
  spaceId:           string
  accountId:         string
  role:              SpaceRole
  encryptedSpaceKey: string
  iv:                string
  joinedAt:          string
}

export interface SpaceInvite {
  id:         string
  spaceId:    string
  createdBy:  string
  token:      string
  expiresAt:  string
  usedAt:     string | null
  approved:   boolean
  approvedBy: string | null
}

export interface PendingClip {
  id:        string
  accountId: string
  spaceId:   string | null
  content:   string
  type:      ClipType
  createdAt: string
}

export interface ToastDestination {
  accountId:    string
  accountEmail: string
  spaceId:      string | null
  spaceName:    string | null
}

export interface NotificationPayload {
  title:    string
  body:     string
  tag:      NotificationTrigger
  url:      string
  actions?: { action: string; title: string }[]
}

export interface SyncQueueItem {
  id:        string
  operation: 'insert' | 'update' | 'delete'
  table:     string
  payload:   Record<string, unknown>
  createdAt: string
}

export interface CryptoKeys {
  accountKey: CryptoKey
  spaceKeys:  Record<string, CryptoKey>
}

// Extension auth bridge — stored in browser.storage.local
export interface ExtAccountRecord {
  id:         string
  email:      string
  totpSecret: string   // plaintext kept for extension use only
  createdAt:  string
}
