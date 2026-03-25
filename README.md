
# Clipord

Secure, encrypted, cross-device clipboard manager.

## Features

- E2E encrypted — server never sees plaintext
- Cross-device sync via Supabase Realtime
- Works on iPhone, Android, desktop (PWA + browser extension)
- Multiple accounts on same device — fully isolated
- Shared spaces with invite-only access
- Email OTP first login + TOTP every login after
- Biometric support (Face ID, Fingerprint, Windows Hello)
- Offline-first via IndexedDB
- Android background auto-save + Share Sheet
- Browser extension (Chrome, Firefox, Edge) with copy toast

## Setup

### 1. Clone and install
```bash
git clone https://github.com/life-web-arch/clipord.git
cd clipord
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in your Supabase URL, anon key, and VAPID public key
```

### 3. Set up Supabase

- Create a project at supabase.com
- Run `supabase/schema.sql` in the SQL editor
- Enable Email OTP in Authentication settings
- Copy URL and anon key to `.env`

### 4. Run locally
```bash
npm run dev
```

### 5. Build
```bash
npm run build:all
```

- PWA output: `dist/pwa/`
- Extension output: `dist/extension/`

## Stack

- Vite + React + TypeScript + Tailwind CSS
- WebCrypto API (AES-256-GCM + PBKDF2)
- Dexie.js (IndexedDB)
- Supabase (Auth + Realtime)
- otpauth + qrcode (TOTP)
- webextension-polyfill (MV3)

## License

MIT
