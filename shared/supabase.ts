import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

export async function sendEmailOTP(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
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

export async function sendPasswordResetEmail(
  email: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${import.meta.env.VITE_APP_URL}/reset-password`,
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
          : `account_id=eq.${accountId}&space_id=is.null`,
      },
      (payload) => onInsert(payload.new as Record<string, unknown>)
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
