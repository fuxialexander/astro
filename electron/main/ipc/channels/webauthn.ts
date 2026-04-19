/**
 * WebAuthn / passkey IPC channel.
 *
 * Routes navigator.credentials.create/get from the renderer through
 * electron-webauthn-mac, which calls Apple's AuthenticationServices
 * framework and shows a real Touch ID / iCloud Keychain prompt.
 *
 * Requires:
 *   - com.apple.security.device.biometric entitlement (already set)
 *   - com.apple.developer.associated-domains entitlement with
 *     webcredentials:astroanywhere.com (set in entitlements.mac.plist)
 *   - apple-app-site-association deployed at
 *     https://astroanywhere.com/.well-known/apple-app-site-association
 */

import { defineHandler } from '../registry.js'
import * as schema from '../schema/webauthn.js'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webauthn = require('electron-webauthn-mac')

export function registerWebAuthnChannels(): void {
  defineHandler('webauthn:isAvailable', schema.isAvailable, async () => {
    const available = typeof webauthn.isAvailable === 'function'
      ? await webauthn.isAvailable()
      : true
    return { available }
  })

  defineHandler('webauthn:create', schema.create, async (req) => {
    return await webauthn.createCredential(req)
  })

  defineHandler('webauthn:get', schema.get, async (req) => {
    return await webauthn.getCredential(req)
  })
}
