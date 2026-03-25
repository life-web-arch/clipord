import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useBiometric } from '../../hooks/useBiometric'
import { signOut } from '@shared/supabase'
import type { VerificationMethod } from '@shared/types'
import { Spinner } from '../ui/Spinner'

interface Props {
  onClose: () => void
}

export function SettingsPage({ onClose }: Props) {
  const {
    activeAccount,
    deviceSettings,
    refreshSettings,
    lockApp,
    removeAccount,
    saveDeviceSettings,
  } = useAuth()

  const { isAvailable: isBiometricAvailable, register: registerBiometric } = useBiometric()

  const [biometricSupported, setBiometricSupported] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const[confirmSignOut, setConfirmSignOut] = useState(false)

  const [verificationEnabled, setVerificationEnabled] = useState(
    deviceSettings?.verificationEnabled ?? true
  )
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>(
    deviceSettings?.verificationMethod ?? 'totp'
  )
  const[cacheWipeDays, setCacheWipeDays] = useState<number | null>(
    deviceSettings?.cacheWipeAfterDays ?? null
  )

  useEffect(() => {
    if (deviceSettings) {
      setVerificationEnabled(deviceSettings.verificationEnabled)
      setVerificationMethod(deviceSettings.verificationMethod)
      setCacheWipeDays(deviceSettings.cacheWipeAfterDays)
    }
  }, [deviceSettings])

  useEffect(() => {
    isBiometricAvailable().then(setBiometricSupported)
  },[isBiometricAvailable])

  const flash = useCallback((text: string, ok = true) => {
    setMessage({ text, ok })
    setTimeout(() => setMessage(null), 3000)
  },[])

  const handleSave = async () => {
    if (!activeAccount) return
    setSaving(true)
    await saveDeviceSettings({
      verificationEnabled,
      verificationMethod,
      cacheWipeAfterDays: cacheWipeDays,
    })
    await refreshSettings()
    flash('Settings saved')
    setSaving(false)
  }

  const handleMethodChange = async (m: VerificationMethod) => {
    if (!activeAccount) return
    if (m === 'biometric' || m === 'both') {
      const isReg = localStorage.getItem(`clipord_webauthn_${activeAccount.id}`)
      if (!isReg) {
        setSaving(true)
        const ok = await registerBiometric(activeAccount.id, activeAccount.email)
        setSaving(false)
        if (!ok) {
          flash('Biometric setup failed or cancelled.', false)
          return
        }
      }
    }
    setVerificationMethod(m)
  }

  const handleEnableBiometric = async () => {
    if (!activeAccount) return
    setSaving(true)
    const ok = await registerBiometric(activeAccount.id, activeAccount.email)
    if (ok) {
      setVerificationMethod('biometric')
      await saveDeviceSettings({ verificationMethod: 'biometric' })
      flash('Biometric enabled')
    } else {
      flash('Biometric setup failed — try again', false)
    }
    setSaving(false)
  }

  const handleSignOut = async () => {
    await signOut()
    if (activeAccount) await removeAccount(activeAccount.id)
    lockApp()
    onClose()
  }

  if (!activeAccount) return null

  return (
    <div className="fixed inset-0 bg-dark-0 z-50 flex flex-col safe-top safe-bottom overflow-y-auto">
      <div className="sticky top-0 bg-dark-0/90 backdrop-blur-md border-b border-dark-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-dark-200 transition-colors text-white/60 hover:text-white"
          aria-label="Close settings"
        >
          ←
        </button>
        <h2 className="text-white font-semibold flex-1">Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary py-1.5 px-4 text-sm flex items-center gap-2"
        >
          {saving ? <Spinner size="sm" /> : 'Save'}
        </button>
      </div>

      {message && (
        <div className={`mx-4 mt-3 px-4 py-3 rounded-xl text-sm font-medium ${
          message.ok
            ? 'bg-green-500/20 border border-green-500/40 text-green-300'
            : 'bg-red-500/20 border border-red-500/40 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex-1 px-4 py-4 space-y-6 max-w-lg mx-auto w-full">
        <section className="card">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Account</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-clipord-600/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-clipord-400 font-semibold">
                {activeAccount.email[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate">{activeAccount.email}</p>
              <p className="text-white/30 text-xs">Signed in</p>
            </div>
          </div>
        </section>

        <section className="card space-y-4">
          <p className="text-white/40 text-xs uppercase tracking-wider">Security</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">Require verification</p>
              <p className="text-white/40 text-xs mt-0.5">Ask for code on every unlock</p>
            </div>
            <button
              onClick={() => setVerificationEnabled((v) => !v)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                verificationEnabled ? 'bg-clipord-600' : 'bg-dark-300'
              }`}
              role="switch"
              aria-checked={verificationEnabled}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                verificationEnabled ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {verificationEnabled && (
            <>
              <div>
                <p className="text-white text-sm font-medium mb-2">Verification method</p>
                <div className="space-y-2">
                  {(['totp', 'biometric', 'both'] as VerificationMethod[]).map((m) => (
                    <label key={m} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                      verificationMethod === m ? 'bg-clipord-600/20 border border-clipord-500/30' : 'bg-dark-100 hover:bg-dark-200'
                    }`}>
                      <input
                        type="radio"
                        name="verificationMethod"
                        value={m}
                        checked={verificationMethod === m}
                        onChange={() => handleMethodChange(m)}
                        className="accent-clipord-500"
                      />
                      <div>
                        <p className="text-white text-sm">
                          {m === 'totp' && '🔑 Authenticator app (TOTP)'}
                          {m === 'biometric' && '👆 Biometric (Face ID / Fingerprint)'}
                          {m === 'both' && '🔐 Both — biometric then TOTP'}
                        </p>
                        <p className="text-white/30 text-xs">
                          {m === 'totp' && 'Use a 6-digit code from Google Authenticator, Authy, etc.'}
                          {m === 'biometric' && 'Use device biometrics with TOTP as fallback'}
                          {m === 'both' && 'Highest security — requires both methods'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {biometricSupported && (verificationMethod === 'biometric' || verificationMethod === 'both') && (
                <button
                  onClick={handleEnableBiometric}
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl border border-clipord-500/30 text-clipord-400 text-sm hover:bg-clipord-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <Spinner size="sm" /> : '👆 Re-register biometric for this device'}
                </button>
              )}
            </>
          )}
        </section>

        <section className="card space-y-4">
          <p className="text-white/40 text-xs uppercase tracking-wider">Privacy</p>
          <div>
            <p className="text-white text-sm font-medium mb-1">Auto-wipe cache</p>
            <p className="text-white/40 text-xs mb-3">
              Automatically delete locally cached clips after this many days.
              They remain in sync until re-fetched.
            </p>
            <div className="flex gap-2 flex-wrap">
              {[null, 7, 14, 30, 90].map((days) => (
                <button
                  key={days ?? 'never'}
                  onClick={() => setCacheWipeDays(days)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    cacheWipeDays === days
                      ? 'bg-clipord-600 text-white'
                      : 'bg-dark-200 text-white/50 hover:bg-dark-300'
                  }`}
                >
                  {days === null ? 'Never' : `${days}d`}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="card border-red-500/20 space-y-3">
          <p className="text-white/40 text-xs uppercase tracking-wider">Danger zone</p>
          <button
            onClick={lockApp}
            className="w-full py-2.5 rounded-xl bg-dark-200 hover:bg-dark-300 text-white/60 text-sm transition-colors"
          >
            🔒 Lock app now
          </button>
          {!confirmSignOut ? (
            <button
              onClick={() => setConfirmSignOut(true)}
              className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors"
            >
              Sign out & remove from device
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-red-400/70 text-xs text-center">
                This will remove all local data for this account. Synced clips stay on the server.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmSignOut(false)}
                  className="flex-1 py-2 rounded-xl bg-dark-200 hover:bg-dark-300 text-white/60 text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="text-center text-white/20 text-xs pb-4">
          Clipord v1.0.0 · End-to-end encrypted
        </p>
      </div>
    </div>
  )
}
