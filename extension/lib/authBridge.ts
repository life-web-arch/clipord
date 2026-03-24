import browser from 'webextension-polyfill'

const EXT_ACCOUNTS_KEY = 'clipord_ext_accounts'
const EXT_DEVICE_KEY   = 'clipord_ext_device_id'

export interface ExtAccountRecord {
  id:         string
  email:      string
  totpSecret: string
  sbSession?: any
  createdAt:  string
}

export async function syncAccountToExtension(
  accountId: string,
  email: string,
  totpSecret: string,
  sbSession?: any
): Promise<void> {
  const result   = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  const existing = (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ??[]
  const filtered = existing.filter((a) => a.id !== accountId)
  const record: ExtAccountRecord = {
    id:         accountId,
    email,
    totpSecret,
    sbSession,
    createdAt:  new Date().toISOString(),
  }
  await browser.storage.local.set({ [EXT_ACCOUNTS_KEY]:[...filtered, record] })
}

export async function getExtAccounts(): Promise<ExtAccountRecord[]> {
  const result = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  return (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ??[]
}

export async function removeExtAccount(accountId: string): Promise<void> {
  const result   = await browser.storage.local.get(EXT_ACCOUNTS_KEY)
  const existing = (result[EXT_ACCOUNTS_KEY] as ExtAccountRecord[] | undefined) ??[]
  const filtered = existing.filter((a) => a.id !== accountId)
  await browser.storage.local.set({ [EXT_ACCOUNTS_KEY]: filtered })
}

export async function getExtDeviceId(): Promise<string> {
  const result = await browser.storage.local.get(EXT_DEVICE_KEY)
  let id = result[EXT_DEVICE_KEY] as string | undefined
  if (!id) {
    id = crypto.randomUUID()
    await browser.storage.local.set({[EXT_DEVICE_KEY]: id })
  }
  return id
}
