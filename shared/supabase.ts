import { createClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Space } from './types'
import { decryptSpaceKey } from './crypto'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

// ---- Auth ----

export async function sendEmailOTP(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: undefined },
  })
  return { error: error?.message ?? null }
}

export async function verifyEmailOTP(
  email: string,
  token: string
): Promise<{ error: string | null; userId: string | null }> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  return { error: error?.message ?? null, userId: data.user?.id ?? null }
}

export async function sendPasswordResetEmail(
  email: string,
  redirectTo: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  return { error: error?.message ?? null }
}

export async function updatePassword(
  newPassword: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// ---- Salt sync (for true cross-device E2E) ----

export async function fetchSaltFromServer(): Promise<string | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const meta = user.user_metadata as Record<string, string> | null
  return meta?.['vault_salt'] ?? null
}

export async function saveSaltToServer(saltB64: string): Promise<void> {
  await supabase.auth.updateUser({
    data: { vault_salt: saltB64 },
  })
}

// ---- Realtime subscriptions ----

export function subscribeToClips(
  accountId: string,
  spaceId: string | null,
  onInsert: (clip: Record<string, unknown>) => void,
  onUpdate: (clip: Record<string, unknown>) => void,
  onDelete: (clipId: string) => void
): RealtimeChannel {
  const channelName = spaceId
    ? 'clips:space:' + spaceId
    : 'clips:personal:' + accountId

  // IMPORTANT: Supabase Realtime only supports ONE filter per subscription.
  // For personal clips we filter by account_id only, then filter space_id in JS.
  const filter = spaceId
    ? 'space_id=eq.' + spaceId
    : 'account_id=eq.' + accountId

  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'clips', filter },
      (payload) => {
        const row = payload.new as Record<string, unknown>
        // Client-side filter for personal clips (space_id must be null)
        if (!spaceId && row['space_id'] !== null) return
        onInsert(row)
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'clips', filter },
      (payload) => {
        const row = payload.new as Record<string, unknown>
        if (!spaceId && row['space_id'] !== null) return
        onUpdate(row)
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'clips' },
      (payload) => onDelete((payload.old as { id: string }).id)
    )
    .subscribe()
}

export function subscribeToSpaceInvites(
  spaceId: string,
  onPending: (invite: Record<string, unknown>) => void
): RealtimeChannel {
  return supabase
    .channel('invites:' + spaceId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'space_invites', filter: 'space_id=eq.' + spaceId },
      (payload) => onPending(payload.new as Record<string, unknown>)
    )
    .subscribe()
}

export function subscribeToSpaceMembers(
  spaceId: string,
  onUpdate: (member: Record<string, unknown>) => void
): RealtimeChannel {
  return supabase
    .channel('members:' + spaceId)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'space_members', filter: 'space_id=eq.' + spaceId },
      (payload) => onUpdate(payload.new as Record<string, unknown>)
    )
    .subscribe()
}

// ---- Space CRUD ----

export interface SpaceRow {
  id:                  string
  name:                string
  creator_id:          string
  allow_member_invite: boolean
  created_at:          string
}

export interface SpaceMemberRow {
  space_id:            string
  account_id:          string
  role:                string
  encrypted_space_key: string
  iv:                  string
  joined_at:           string
}

export async function createSpaceInSupabase(
  name: string,
  creatorId: string,
  encryptedSpaceKey: string,
  iv: string
): Promise<{ spaceId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('spaces')
    .insert({ name, creator_id: creatorId, allow_member_invite: false })
    .select()
    .single()

  if (error || !data) return { spaceId: null, error: error?.message ?? 'Unknown error' }

  const spaceId = (data as SpaceRow).id

  const { error: memberErr } = await supabase
    .from('space_members')
    .insert({
      space_id:            spaceId,
      account_id:          creatorId,
      role:                'creator',
      encrypted_space_key: encryptedSpaceKey,
      iv,
    })

  return { spaceId: memberErr ? null : spaceId, error: memberErr?.message ?? null }
}

/**
 * Fetch all spaces for a user AND decrypt their space keys.
 * Returns Space objects with decrypted spaceKeys ready to use.
 */
export async function getSpacesWithKeys(
  userId: string,
  accountKey: CryptoKey
): Promise<{ spaces: Space[]; spaceKeys: Record<string, CryptoKey> }> {
  const { data: memberships, error: mErr } = await supabase
    .from('space_members')
    .select('*')
    .eq('account_id', userId)

  if (mErr || !memberships || memberships.length === 0) {
    return { spaces: [], spaceKeys: {} }
  }

  const spaceIds = (memberships as SpaceMemberRow[]).map((m) => m.space_id)

  const { data: spacesData, error: sErr } = await supabase
    .from('spaces')
    .select('*')
    .in('id', spaceIds)

  if (sErr || !spacesData) return { spaces: [], spaceKeys: {} }

  const spaces: Space[] = []
  const spaceKeys: Record<string, CryptoKey> = {}

  for (const row of spacesData as SpaceRow[]) {
    const membership = (memberships as SpaceMemberRow[]).find((m) => m.space_id === row.id)
    if (!membership) continue

    let spaceKey: CryptoKey | null = null
    if (membership.encrypted_space_key && membership.iv) {
      try {
        spaceKey = await decryptSpaceKey(
          membership.encrypted_space_key,
          membership.iv,
          accountKey
        )
      } catch {
        // Space key not yet distributed (pending approval) — skip
        continue
      }
    } else {
      continue
    }

    spaceKeys[row.id] = spaceKey
    spaces.push({
      id:                row.id,
      name:              row.name,
      creatorId:         row.creator_id,
      allowMemberInvite: row.allow_member_invite,
      encryptedSpaceKey: membership.encrypted_space_key,
      iv:                membership.iv,
      createdAt:         row.created_at,
    })
  }

  return { spaces, spaceKeys }
}

// ---- Invite CRUD ----

export interface InviteRow {
  id:          string
  space_id:    string
  created_by:  string
  token:       string
  expires_at:  string
  used_at:     string | null
  approved:    boolean
  approved_by: string | null
}

export async function createInvite(
  spaceId: string,
  createdBy: string,
  isCreator: boolean
): Promise<{ token: string | null; error: string | null }> {
  const token     = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('space_invites').insert({
    id:         crypto.randomUUID(),
    space_id:   spaceId,
    created_by: createdBy,
    token,
    expires_at: expiresAt,
    approved:   isCreator,
  })

  return { token: error ? null : token, error: error?.message ?? null }
}

export async function getInviteByToken(token: string): Promise<{ data: InviteRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('space_invites')
    .select('*')
    .eq('token', token)
    .single()
  return { data: data as InviteRow | null, error: error?.message ?? null }
}

export async function markInviteUsed(inviteId: string): Promise<void> {
  await supabase
    .from('space_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', inviteId)
}

// ---- Clip remote CRUD ----

export async function upsertClipRemote(
  clipSnake: Record<string, unknown>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('clips').upsert(clipSnake)
  return { error: error?.message ?? null }
}

export async function deleteClipRemote(clipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('clips').delete().eq('id', clipId)
  return { error: error?.message ?? null }
}

// ---- Push subscription storage ----

export async function savePushSubscription(
  accountId: string,
  subscription: PushSubscriptionJSON
): Promise<void> {
  await supabase.from('push_subscriptions').upsert({
    account_id:   accountId,
    subscription: JSON.stringify(subscription),
    updated_at:   new Date().toISOString(),
  })
}
