import browser from 'webextension-polyfill'
import { decryptText, importVaultKey } from '@shared/crypto'
import { getExtAccounts } from './authBridge'

export interface StoredClip {
  id:        string
  accountId: string
  spaceId:   string | null
  content:   string
  type:      string
  preview:   string
  createdAt: string
}

export async function loadClipsEncrypted(accountId: string): Promise<StoredClip[]> {
  const accounts = await getExtAccounts()
  const acc = accounts.find(a => a.id === accountId)
  if (!acc || !acc.accessToken) return[]

  try {
    const url = import.meta.env.VITE_SUPABASE_URL
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
    const res = await fetch(`${url}/rest/v1/clips?account_id=eq.${accountId}&order=created_at.desc&limit=50`, {
      headers: { 'apikey': anon, 'Authorization': `Bearer ${acc.accessToken}` }
    })
    if (!res.ok) throw new Error('Fetch failed or offline')
    
    const rows = await res.json()
    const key = await importVaultKey(acc.vaultKey)
    const out: StoredClip[] =[]
    
    for (const r of rows) {
      try {
        const text = await decryptText(r.encrypted_content, r.iv, key)
        out.push({
          id: r.id, accountId: r.account_id, spaceId: r.space_id,
          content: text, type: r.type, preview: r.preview, createdAt: r.created_at
        })
      } catch(e) {}
    }
    
    await browser.storage.local.set({ [`clipord_cache_${accountId}`]: JSON.stringify(out) })
    return out
  } catch (error) {
    const cached = await browser.storage.local.get(`clipord_cache_${accountId}`)
    const data = cached[`clipord_cache_${accountId}`] as string | undefined
    return data ? JSON.parse(data) :[]
  }
}

export async function deleteClipRemote(accountId: string, clipId: string): Promise<void> {
  const accounts = await getExtAccounts()
  const acc = accounts.find(a => a.id === accountId)
  if (!acc || !acc.accessToken) return
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  await fetch(`${url}/rest/v1/clips?id=eq.${clipId}`, {
    method: 'DELETE',
    headers: { 'apikey': anon, 'Authorization': `Bearer ${acc.accessToken}` }
  }).catch(() => {})
}
