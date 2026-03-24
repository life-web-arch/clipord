import browser from 'webextension-polyfill'

let toastEl: HTMLElement | null = null
let dismissTimer: ReturnType<typeof setTimeout> | null = null

// Deduplication: track last sent content to avoid flooding
let lastSentContent = ''
let lastSentTime    = 0
const DEBOUNCE_MS   = 500 // ignore duplicate sends within 500ms

browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (message.type === 'GET_CLIPBOARD') {
    navigator.clipboard.readText().then((text) => {
      if (text?.trim()) {
        browser.runtime.sendMessage({ type: 'CLIPBOARD_CONTENT', content: text })
      }
    }).catch(() => {})
  }
  if (message.type === 'SHOW_TOAST') {
    showClipordToast(
      message.preview  as string,
      message.content  as string,
      message.accounts as StoredAccount[]
    )
  }
})

// Deduplicated copy event listener
document.addEventListener('copy', () => {
  setTimeout(() => {
    navigator.clipboard.readText().then((text) => {
      if (!text?.trim()) return

      const now = Date.now()
      // Skip if same content was sent very recently
      if (text === lastSentContent && now - lastSentTime < DEBOUNCE_MS) return

      lastSentContent = text
      lastSentTime    = now
      browser.runtime.sendMessage({ type: 'CLIPBOARD_CONTENT', content: text })
    }).catch(() => {})
  }, 100)
})

function showClipordToast(preview: string, content: string, accounts: StoredAccount[]) {
  removeExistingToast()

  toastEl = document.createElement('div')
  toastEl.id = 'clipord-toast'
  toastEl.innerHTML = buildToastHTML(preview, accounts)
  applyToastStyles(toastEl)
  document.body.appendChild(toastEl)

  toastEl.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const target    = (e.currentTarget as HTMLElement)
      const accountId = target.getAttribute('data-account-id') ?? ''
      const spaceId   = target.getAttribute('data-space-id') ?? null
      await browser.runtime.sendMessage({ type: 'SAVE_CLIP', content, spaceId, accountId })
      removeExistingToast()
    })
  })

  toastEl.querySelector('[data-dismiss]')?.addEventListener('click', removeExistingToast)

  toastEl.querySelectorAll('[data-new-space]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const accountId  = (e.currentTarget as HTMLElement).getAttribute('data-account-id') ?? ''
      const container  = toastEl?.querySelector(`[data-new-space-form="${accountId}"]`) as HTMLElement | null
      if (container) container.style.display = container.style.display === 'none' ? 'block' : 'none'
    })
  })

  toastEl.querySelectorAll('[data-create-space]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const accountId = (e.currentTarget as HTMLElement).getAttribute('data-account-id') ?? ''
      const nameInput = toastEl?.querySelector<HTMLInputElement>(`[data-space-name="${accountId}"]`)
      const name      = nameInput?.value.trim()
      if (!name) return
      await browser.runtime.sendMessage({ type: 'CREATE_SPACE_AND_SAVE', content, accountId, spaceName: name })
      removeExistingToast()
    })
  })

  dismissTimer = setTimeout(removeExistingToast, 8000)
}

function buildToastHTML(preview: string, accounts: StoredAccount[]): string {
  const accountsHTML = accounts.map((acc) => `
    <div style="margin-bottom:8px;">
      <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        👤 ${escapeHTML(acc.email)}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button data-save data-account-id="${acc.id}" data-space-id="" style="${btnStyle('#4f52e5')}">Personal</button>
        <button data-new-space data-account-id="${acc.id}" style="${btnStyle('#2e2e42')}">+ New Space</button>
      </div>
      <div data-new-space-form="${acc.id}" style="display:none;margin-top:6px;">
        <input data-space-name="${acc.id}" type="text" placeholder="Space name..."
          style="width:100%;background:#1c1c28;border:1px solid #3636a4;border-radius:6px;padding:5px 8px;color:white;font-size:11px;outline:none;box-sizing:border-box;" maxlength="40" />
        <button data-create-space data-account-id="${acc.id}"
          style="${btnStyle('#4f52e5')};margin-top:4px;width:100%;">Create & Save</button>
      </div>
    </div>
  `).join('')

  return `
    <div style="margin-bottom:8px;">
      <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:2px;">📋 Save to Clipord?</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(preview)}</div>
    </div>
    <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:8px;"></div>
    ${accountsHTML}
    <button data-dismiss style="${btnStyle('transparent')};color:rgba(255,255,255,0.3);width:100%;margin-top:2px;">Dismiss</button>
  `
}

function btnStyle(bg: string): string {
  return `background:${bg};border:none;border-radius:6px;padding:5px 10px;color:white;font-size:11px;cursor:pointer;font-family:inherit;`
}

function applyToastStyles(el: HTMLElement) {
  Object.assign(el.style, {
    position:     'fixed',
    bottom:       '20px',
    right:        '20px',
    zIndex:       '2147483647',
    background:   '#16161e',
    border:       '1px solid #2e2e42',
    borderRadius: '12px',
    padding:      '12px',
    width:        '260px',
    boxShadow:    '0 8px 32px rgba(0,0,0,0.6)',
    fontFamily:   'system-ui, sans-serif',
    animation:    'clipordSlideIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
  })
  const style = document.createElement('style')
  style.textContent = `
    @keyframes clipordSlideIn {
      from { transform: translateX(110%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
  `
  document.head.appendChild(style)
}

function removeExistingToast() {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
  if (toastEl) { toastEl.remove(); toastEl = null }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface StoredAccount {
  id:    string
  email: string
}
