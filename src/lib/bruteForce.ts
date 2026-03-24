import { db } from '@shared/db'

const MAX_ATTEMPTS  = 5
const LOCKOUT_MS    = 15 * 60 * 1000
const BF_KEY_PREFIX = 'clipord_bf_'

interface BFRecord {
  attempts:    number
  lockedUntil: number | null
  lastAttempt: number
}

// Safe localStorage wrapper for cross-environment compatibility
function getStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function getKey(accountId: string): string {
  return `${BF_KEY_PREFIX}${accountId}`
}

function load(accountId: string): BFRecord {
  const storage = getStorage();
  if (storage) {
    try {
      const raw = storage.getItem(getKey(accountId))
      if (raw) return JSON.parse(raw)
    } catch { /* */ }
  }
  return { attempts: 0, lockedUntil: null, lastAttempt: 0 }
}

function save(accountId: string, record: BFRecord): void {
  const storage = getStorage();
  if (storage) {
    storage.setItem(getKey(accountId), JSON.stringify(record))
  }
}

export function checkLockout(accountId: string): {
  locked:      boolean
  remainingMs: number
  attemptsLeft: number
} {
  const rec = load(accountId)
  if (rec.lockedUntil) {
    const remaining = rec.lockedUntil - Date.now()
    if (remaining > 0) {
      return { locked: true, remainingMs: remaining, attemptsLeft: 0 }
    }
    // Lockout expired — reset
    save(accountId, { attempts: 0, lockedUntil: null, lastAttempt: 0 })
  }
  return {
    locked:       false,
    remainingMs:  0,
    attemptsLeft: MAX_ATTEMPTS - rec.attempts,
  }
}

export function recordFailure(accountId: string): {
  locked:       boolean
  remainingMs:  number
  attemptsLeft: number
} {
  const rec      = load(accountId)
  rec.attempts   = (rec.attempts || 0) + 1
  rec.lastAttempt = Date.now()

  if (rec.attempts >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS
    rec.attempts    = 0
    save(accountId, rec)
    return { locked: true, remainingMs: LOCKOUT_MS, attemptsLeft: 0 }
  }

  save(accountId, rec)
  return {
    locked:       false,
    remainingMs:  0,
    attemptsLeft: MAX_ATTEMPTS - rec.attempts,
  }
}

export function recordSuccess(accountId: string): void {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(getKey(accountId))
  }
}

export function formatLockoutTime(ms: number): string {
  const mins = Math.ceil(ms / 60000)
  return `${mins} minute${mins !== 1 ? 's' : ''}`
}
