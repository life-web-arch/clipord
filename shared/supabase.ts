import { createClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

// ---- Auth helpers ----

export async function sendEmailOTP(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: undefined,
    },
  })
  return { error: error?.message ?? null }
}

export async function verifyEmailOTP(
  email: string,
  token: string
): Promise<{ error: string | null; userId: string | null }> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  return {
    error: error?.message ?? null,
    userId: data.user?.id ?? null,
  }
}

export async function sendPasswordResetEmail(
  email: string,
  redirectTo: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })
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

// ---- Clip sync ----

export function subscribeToClips(
  accountId: string,
  spaceId: string | null,
  onInsert: (clip: Record<string, unknown>) => void,
  onDelete: (clipId: string) => void
): RealtimeChannel {
  const channelName = spaceId
    ? 'clips:space:' + spaceId
    : 'clips:personal:' + accountId

  const filter = spaceId
    ? 'space_id=eq.' + spaceId
    : 'account_id=eq.' + accountId + '&space_id=is.null'

  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'clips', filter },
      (payload) => onInsert(payload.new as Record<string, unknown>)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'clips' },
      (payload) => onDelete((payload.old as { id: string }).id)
    )
    .subscribe()
}

// ---- Space sync ----

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
  id: string
  name: string
  creator_id: string
  allow_member_invite: boolean
  created_at: string
}

export async function createSpace(
  name: string,
  creatorId: string
): Promise<{ data: SpaceRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('spaces')
    .insert({ name, creator_id: creatorId, allow_member_invite: false })
    .select()
    .single()
  return { data: data as SpaceRow | null, error: error?.message ?? null }
}

export async function getSpacesForUser(userId: string): Promise<SpaceRow[]> {
  const { data: memberships } = await supabase
    .from('space_members')
    .select('space_id')
    .eq('account_id', userId)

  if (!memberships || memberships.length === 0) return []

  const ids = memberships.map((m: { space_id: string }) => m.space_id)
  const { data } = await supabase
    .from('spaces')
    .select('*')
    .in('id', ids)

  return (data as SpaceRow[]) ?? []
}

export async function addCreatorToSpace(
  spaceId: string,
  accountId: string,
  encryptedSpaceKey: string,
  iv: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('space_members')
    .insert({
      space_id: spaceId,
      account_id: accountId,
      role: 'creator',
      encrypted_space_key: encryptedSpaceKey,
      iv,
    })
  return { error: error?.message ?? null }
}

// ---- Invite CRUD ----

export interface InviteRow {
  id: string
  space_id: string
  created_by: string
  token: string
  expires_at: string
  used_at: string | null
  approved: boolean
  approved_by: string | null
}

export async function createInvite(
  spaceId: string,
  createdBy: string,
  isCreator: boolean
): Promise<{ token: string | null; error: string | null }> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('space_invites')
    .insert({
      id: crypto.randomUUID(),
      space_id: spaceId,
      created_by: createdBy,
      token,
      expires_at: expiresAt,
      approved: isCreator,
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

export async function acceptInvite(
  spaceId: string,
  accountId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('space_members')
    .insert({
      space_id: spaceId,
      account_id: accountId,
      role: 'member',
      encrypted_space_key: '',
      iv: '',
    })
  return { error: error?.message ?? null }
}

// ---- Clip CRUD ----

export interface ClipRow {
  id: string
  account_id: string
  space_id: string | null
  type: string
  preview: string
  encrypted_content: string
  iv: string
  pinned: boolean
  tags: string[]
  wipe_at: string | null
  created_at: string
  updated_at: string
}

export async function upsertClipRemote(clip: ClipRow): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('clips')
    .upsert({
      id: clip.id,
      account_id: clip.account_id,
      space_id: clip.space_id,
      type: clip.type,
      preview: clip.preview,
      encrypted_content: clip.encrypted_content,
      iv: clip.iv,
      pinned: clip.pinned,
      tags: clip.tags,
      wipe_at: clip.wipe_at,
      created_at: clip.created_at,
      updated_at: clip.updated_at,
    })
  return { error: error?.message ?? null }
}

export async function deleteClipRemote(clipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('clips').delete().eq('id', clipId)
  return { error: error?.message ?? null }
}
