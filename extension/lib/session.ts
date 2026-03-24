import browser from 'webextension-polyfill'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const SESSION_KEY        = 'clipord_ext_session'
const MAX_ATTEMPTS       = 5
const LOCKOUT_MS         = 15 * 60 * 1000

interface ExtSession {
  accountId:    string
  verifiedAt:   number
  expiresAt:    number
}

interface BruteForceState {
  attempts:   number
  lockedUntil: number | null
}

// Session lives only in memory — cleared when browser closes
let memorySession: ExtSession | null = null
let bruteForceMap: Record<string, BruteForceState> = {}

export function setSession(accountId: string): void {
  const now = Date.now()
  memorySession = {
    accountId,
    verifiedAt: now,
    expiresAt:  now + SESSION_TIMEOUT_MS,
  }
}

export function getSession(): ExtSession | null {
  if (!memorySession) return null
  if (Date.now() > memorySession.expiresAt) {
    memorySession = null
    return null
  }
  return memorySession
}

export function clearSession(): void {
  memorySession = null
}

export function refreshSession(): void {
  if (memorySession) {
    memorySession.expiresAt = Date.now() + SESSION_TIMEOUT_MS
  }
}

export function isSessionValid(accountId: string): boolean {
  const session = getSession()
  return session !== null && session.accountId === accountId
}

export function getRemainingMs(): number {
  if (!memorySession) return 0
  return Math.max(0, memorySession.expiresAt - Date.now())
}

// Brute force protection
export function recordFailedAttempt(accountId: string): {
  attemptsLeft: number
  lockedOut:    boolean
  lockedUntilMs: number | null
} {
  const state = bruteForceMap[accountId] ?? { attempts: 0, lockedUntil: null }
  state.attempts++

  if (state.attempts >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS
    state.attempts    = 0
  }

  bruteForceMap[accountId] = state

  const lockedOut = state.lockedUntil !== null && Date.now() < state.lockedUntil
  return {
    attemptsLeft:  Math.max(0, MAX_ATTEMPTS - state.attempts),
    lockedOut,
    lockedUntilMs: state.lockedUntil,
  }
}

export function isLockedOut(accountId: string): {
  locked: boolean
  remainingMs: number
} {
  const state = bruteForceMap[accountId]
  if (!state?.lockedUntil) return { locked: false, remainingMs: 0 }
  const remaining = state.lockedUntil - Date.now()
  if (remaining <= 0) {
    bruteForceMap[accountId] = { attempts: 0, lockedUntil: null }
    return { locked: false, remainingMs: 0 }
  }
  return { locked: true, remainingMs: remaining }
}

export function clearBruteForce(accountId: string): void {
  delete bruteForceMap[accountId]
}
