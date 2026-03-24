# Clipord Setup Notes

## Critical Supabase Dashboard Configuration

### Fix OTP Email (6-digit code instead of magic link)

1. Go to your Supabase project → **Authentication** → **Providers** → **Email**
2. **Disable "Confirm email"** (or keep enabled but configure template)
3. Go to **Authentication** → **Email Templates** → **Magic Link**
4. Change the template body to:
```
   Your Clipord verification code: {{ .Token }}
```
   Subject: `Your Clipord code: {{ .Token }}`
5. Go to **Authentication** → **Settings**:
   - Set **OTP Expiry** to `600` (10 minutes)
   - Enable **"Enable email OTP"** if available

**Alternative (simpler):** In Supabase dashboard → Authentication → Settings,
set the "Mailer OTP Expiry" and make sure you're using `signInWithOtp` 
with `type: 'email'` (which this app already does). The email template
must output `{{ .Token }}` as a 6-digit number.

### Fix Password Reset Email

1. Go to **Authentication** → **Email Templates** → **Reset Password**
2. The default template already works, but make sure `VITE_APP_URL` in your `.env`
   matches your deployment URL exactly (e.g., `https://clipord.app`)
3. In Supabase → **Authentication** → **URL Configuration**:
   - Add `https://your-domain.com/reset-password` to **Redirect URLs**

### PWA Install Button

For Chrome/Android to show the "Add to Home Screen" install prompt:
1. Your app must be served over HTTPS
2. The manifest.json must have `display: "standalone"` ✅ (already set)
3. Service worker must be registered ✅ (already done)
4. You need the maskable icons at the paths specified in manifest.json
   - `/icons/icon-192-maskable.png`
   - `/icons/icon-512-maskable.png`
   Generate these at: https://maskable.app/

For iOS Safari: PWA install is via "Share → Add to Home Screen" (no install banner)

### Run after cloning
```bash
npm install
cp .env.example .env
# Fill in your values
npm run dev
```

### Build
```bash
npm run build:pwa        # builds PWA to dist/pwa/
npm run build:extension  # builds extension to dist/extension/
npm run build:all        # builds both
```

After building the extension, install it in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `dist/extension/`
