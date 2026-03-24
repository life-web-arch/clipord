/**
 * Extension session management.
 * Sessions are stored in browser.storage.session (cleared when browser closes).
 * Falls back to browser.storage.local with manual TTL if session storage unavailable.
 */

import browser from 'webextension-polyfill'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const MAX_ATTEMPTS       = 5
const LOCKOUT_MS         = 15 * 60 * 1000
const SESSION_KEY        = 'clipord_session'
const BF_KEY             = 'clipord_bruteforce'

interface SessionRecord {
  accountId:  string
  verifiedAt: number
  expiresAt:  number
}

interface BruteForceRecord {
  [accountId: string]: {
    attempts:    number
    lockedUntil: number | null
  }
}

// Use session storage if available, otherwise local with TTL
async function getStorage() {
  if ('session' in browser.storage) return browser.storage.session
  return browser.storage.local
}

export async function setSession(accountId: string): Promise<void> {
  const store = await getStorage()
  const now   = Date.now()
  const session: SessionRecord = {
    accountId,
    verifiedAt: now,
    expiresAt:  now + SESSION_TIMEOUT_MS,
  }
  await store.set({ [SESSION_KEY]: session })
}

export async function getSession(): Promise<SessionRecord | null> {
  const store  = await getStorage()
  const result = await store.get(SESSION_KEY)
  const session = result[SESSION_KEY] as SessionRecord | undefined
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    await store.remove(SESSION_KEY)
    return null
  }
  return session
}

export async function clearSession(): Promise<void> {
  const store = await getStorage()
  await store.remove(SESSION_KEY)
}

export async function isSessionValid(accountId: string): Promise<boolean> {
  const session = await getSession()
  return session !== null && session.accountId === accountId
}

export async function refreshSession(accountId: string): Promise<void> {
  const session = await getSession()
  if (session?.accountId === accountId) {
    await setSession(accountId)
  }
}

export async function getRemainingMs(): Promise<number> {
  const session = await getSession()
  if (!session) return 0
  return Math.max(0, session.expiresAt - Date.now())
}

// ---- Brute force (stored in local storage to persist across popup open/close) ----

async function getBFRecord(): Promise<BruteForceRecord> {
  const result = await browser.storage.local.get(BF_KEY)
  return (result[BF_KEY] as BruteForceRecord | undefined) ?? {}
}

async function saveBFRecord(record: BruteForceRecord): Promise<void> {
  await browser.storage.local.set({ [BF_KEY]: record })
}

export async function isLockedOut(
  accountId: string
): Promise<{ locked: boolean; remainingMs: number }> {
  const bf    = await getBFRecord()
  const state = bf[accountId]
  if (!state?.lockedUntil) return { locked: false, remainingMs: 0 }
  const remaining = state.lockedUntil - Date.now()
  if (remaining <= 0) {
    const updated = { ...bf }
    delete updated[accountId]
    await saveBFRecord(updated)
    return { locked: false, remainingMs: 0 }
  }
  return { locked: true, remainingMs: remaining }
}

export async function recordFailedAttempt(
  accountId: string
): Promise<{ lockedOut: boolean; attemptsLeft: number; lockedUntilMs: number | null }> {
  const bf    = await getBFRecord()
  const state = bf[accountId] ?? { attempts: 0, lockedUntil: null }
  state.attempts++

  if (state.attempts >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS
    state.attempts    = 0
    await saveBFRecord({ ...bf, [accountId]: state })
    return { lockedOut: true, attemptsLeft: 0, lockedUntilMs: state.lockedUntil }
  }

  await saveBFRecord({ ...bf, [accountId]: state })
  return { lockedOut: false, attemptsLeft: MAX_ATTEMPTS - state.attempts, lockedUntilMs: null }
}

export async function clearBruteForce(accountId: string): Promise<void> {
  const bf      = await getBFRecord()
  const updated = { ...bf }
  delete updated[accountId]
  await saveBFRecord(updated)
}
