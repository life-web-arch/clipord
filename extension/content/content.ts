import browser from 'webextension-polyfill'

let toastEl:      HTMLElement | null = null
let shadowRoot:   ShadowRoot  | null = null
let dismissTimer: ReturnType<typeof setTimeout> | null = null

// Listen for messages from background
browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (message['type'] === 'SHOW_TOAST') {
    showClipordToast(
      message['preview']  as string,
      message['content']  as string,
      message['accounts'] as { id: string; email: string }[]
    )
  }
})

// Listen for copy events — use synchronous clipboard read via execCommand
// to avoid the async gesture requirement
document.addEventListener('copy', () => {
  // We don't read clipboard here — the background gets it via keyboard shortcut
  // or context menu. For the automatic capture, we rely on the user explicitly
  // triggering the save, which avoids all clipboard permission issues.
  browser.runtime.sendMessage({ type: 'COPY_EVENT_FIRED' }).catch(() => {})
})

function showClipordToast(
  preview: string,
  content: string,
  accounts: { id: string; email: string }[]
) {
  removeExistingToast()
  if (!accounts.length) return

  // Use Shadow DOM to prevent host page CSS bleeding
  const host = document.createElement('div')
  host.id    = 'clipord-toast-host'
  Object.assign(host.style, {
    position: 'fixed',
    bottom:   '20px',
    right:    '20px',
    zIndex:   '2147483647',
    all:      'initial',
  })
  document.body.appendChild(host)
  toastEl = host

  shadowRoot = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .toast {
      font-family: system-ui, -apple-system, sans-serif;
      background: #16161e;
      border: 1px solid #2e2e42;
      border-radius: 12px;
      padding: 12px;
      width: 260px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      animation: slideIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
      color: white;
    }
    @keyframes slideIn {
      from { transform: translateX(110%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    .preview {
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .label {
      font-size: 10px;
      color: rgba(255,255,255,0.4);
      margin: 6px 0 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
    .btn {
      background: #4f52e5;
      border: none;
      border-radius: 6px;
      padding: 5px 10px;
      color: white;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
    }
    .btn:hover { background: #6470f1; }
    .btn-ghost { background: #2e2e42; }
    .btn-ghost:hover { background: #3636a4; }
    .dismiss { background: transparent; color: rgba(255,255,255,0.3); width: 100%; margin-top: 4px; }
    .dismiss:hover { color: rgba(255,255,255,0.6); }
    .divider { height: 1px; background: rgba(255,255,255,0.08); margin: 8px 0; }
    .space-form { margin-top: 6px; display: none; }
    .space-input {
      width: 100%;
      background: #1c1c28;
      border: 1px solid #3636a4;
      border-radius: 6px;
      padding: 5px 8px;
      color: white;
      font-size: 11px;
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
      margin-bottom: 4px;
    }
  `
  shadowRoot.appendChild(style)

  const container = document.createElement('div')
  container.className = 'toast'

  // Preview
  const previewEl = document.createElement('div')
  previewEl.className = 'preview'
  previewEl.textContent = '📋 ' + (preview || 'Save to Clipord?')
  container.appendChild(previewEl)

  const divider = document.createElement('div')
  divider.className = 'divider'
  container.appendChild(divider)

  // Account rows
  for (const acc of accounts) {
    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = '👤 ' + acc.email
    container.appendChild(label)

    const row = document.createElement('div')
    row.className = 'row'

    const personalBtn = document.createElement('button')
    personalBtn.className = 'btn'
    personalBtn.textContent = 'Personal'
    personalBtn.addEventListener('click', async () => {
      await browser.runtime.sendMessage({
        type: 'SAVE_CLIP', content, spaceId: null, accountId: acc.id
      })
      removeExistingToast()
    })
    row.appendChild(personalBtn)

    const newSpaceBtn = document.createElement('button')
    newSpaceBtn.className = 'btn btn-ghost'
    newSpaceBtn.textContent = '+ New Space'
    const formId = 'sf-' + acc.id
    newSpaceBtn.addEventListener('click', () => {
      const form = shadowRoot?.getElementById(formId) as HTMLElement | null
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none'
    })
    row.appendChild(newSpaceBtn)
    container.appendChild(row)

    // New space form
    const form    = document.createElement('div')
    form.className = 'space-form'
    form.id        = formId
    form.style.display = 'none'

    const input = document.createElement('input')
    input.className   = 'space-input'
    input.type        = 'text'
    input.placeholder = 'Space name…'
    input.maxLength   = 40
    form.appendChild(input)

    const createBtn = document.createElement('button')
    createBtn.className   = 'btn'
    createBtn.textContent = 'Create & Save'
    createBtn.style.width = '100%'
    createBtn.addEventListener('click', async () => {
      const name = input.value.trim()
      if (!name) return
      await browser.runtime.sendMessage({
        type: 'CREATE_SPACE_AND_SAVE', content, accountId: acc.id, spaceName: name
      })
      removeExistingToast()
    })
    form.appendChild(createBtn)
    container.appendChild(form)
  }

  // Dismiss
  const dismissBtn = document.createElement('button')
  dismissBtn.className   = 'btn dismiss'
  dismissBtn.textContent = 'Dismiss'
  dismissBtn.addEventListener('click', removeExistingToast)
  container.appendChild(dismissBtn)

  shadowRoot.appendChild(container)

  dismissTimer = setTimeout(removeExistingToast, 8000)
}

function removeExistingToast(): void {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
  if (toastEl) { toastEl.remove(); toastEl = null; shadowRoot = null }
}
