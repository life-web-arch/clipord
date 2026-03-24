import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    // Use PKCE flow for security
    flowType: 'pkce',
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

/**
 * Send a 6-digit OTP to the user's email.
 *
 * IMPORTANT — Supabase dashboard setup required:
 *   Authentication → Email → OTP Expiry: 600 (10 min)
 *   Authentication → Email → "Enable Email OTP": ON
 *   Authentication → Templates → "Magic Link" template:
 *     Change subject to "Your Clipord verification code"
 *     Change body to: "Your verification code is: {{ .Token }}"
 *     (This makes Supabase send the raw 6-digit OTP, not a link)
 *
 *   OR go to Authentication → Settings → enable "OTP" login
 *   and disable "Magic link" so users get a code, not a URL.
 */
export async function sendEmailOTP(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // This tells Supabase to send a 6-digit OTP code (not a magic link)
      // when "Email OTP" is enabled in your Supabase project settings
    },
  })
  return { error: error?.message ?? null }
}

export async function verifyEmailOTP(
  email: string,
  token: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  return { error: error?.message ?? null }
}

/**
 * Send a password reset email.
 * The link redirects to VITE_APP_URL/reset-password#access_token=...
 * which our ResetPassword page handles.
 */
export async function sendPasswordResetEmail(
  email: string
): Promise<{ error: string | null }> {
  const appUrl = import.meta.env.VITE_APP_URL as string || window.location.origin
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/reset-password`,
  })
  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function getSpacesWithKeys(accountId: string): Promise
  Array<{
    id:                  string
    name:                string
    creator_id:          string
    allow_member_invite: boolean
    created_at:          string
    encrypted_space_key: string
    iv:                  string
  }>
> {
  const { data, error } = await supabase
    .from('space_members')
    .select(`
      encrypted_space_key,
      iv,
      spaces (
        id,
        name,
        creator_id,
        allow_member_invite,
        created_at
      )
    `)
    .eq('account_id', accountId)

  if (error || !data) return []

  return data
    .filter((row) => row.spaces !== null)
    .map((row) => {
      const space = row.spaces as {
        id: string
        name: string
        creator_id: string
        allow_member_invite: boolean
        created_at: string
      }
      return {
        id:                  space.id,
        name:                space.name,
        creator_id:          space.creator_id,
        allow_member_invite: space.allow_member_invite,
        created_at:          space.created_at,
        encrypted_space_key: row.encrypted_space_key,
        iv:                  row.iv,
      }
    })
}

export async function createSpaceInSupabase(
  name: string,
  creatorId: string,
  encryptedSpaceKey: string,
  iv: string,
  allowMemberInvite = false
): Promise<{ spaceId: string | null; error: string | null }> {
  const spaceId = crypto.randomUUID()

  const { error: spaceErr } = await supabase.from('spaces').insert({
    id:                  spaceId,
    name,
    creator_id:          creatorId,
    allow_member_invite: allowMemberInvite,
  })
  if (spaceErr) return { spaceId: null, error: spaceErr.message }

  const { error: memberErr } = await supabase.from('space_members').insert({
    space_id:            spaceId,
    account_id:          creatorId,
    role:                'creator',
    encrypted_space_key: encryptedSpaceKey,
    iv,
  })
  if (memberErr) return { spaceId: null, error: memberErr.message }

  return { spaceId, error: null }
}

export function subscribeToClips(
  accountId: string,
  spaceId: string | null,
  onInsert: (clip: Record<string, unknown>) => void,
  onDelete: (clipId: string) => void
) {
  const channel = spaceId
    ? `clips:space:${spaceId}`
    : `clips:personal:${accountId}`

  return supabase
    .channel(channel)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'clips',
        filter: spaceId
          ? `space_id=eq.${spaceId}`
          : `account_id=eq.${accountId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>
        if (!spaceId && row['space_id'] !== null) return
        onInsert(row)
      }
    )
    .on(
      'postgres_changes',
      {
        event:  'DELETE',
        schema: 'public',
        table:  'clips',
      },
      (payload) => onDelete((payload.old as { id: string }).id)
    )
    .subscribe()
}

export function subscribeToSpaceInvites(
  spaceId: string,
  onPending: (invite: Record<string, unknown>) => void
) {
  return supabase
    .channel(`invites:${spaceId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'space_invites',
        filter: `space_id=eq.${spaceId}`,
      },
      (payload) => onPending(payload.new as Record<string, unknown>)
    )
    .subscribe()
}
