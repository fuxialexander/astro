import { describe, it, expect } from 'vitest';
import {
  generateDispatchKeyPair,
  exportPublicKeyJWK,
  canonicalizePayload,
  generateNonce,
  signDispatchIntent,
  type DispatchSigningPayload,
} from '../dispatch-signing';

describe('dispatch-signing', () => {
  it('canonicalizes payload deterministically', () => {
    const payload: DispatchSigningPayload = {
      v: 1,
      nodeId: 'node-1',
      projectId: 'proj-1',
      machineId: 'machine-1',
      timestamp: '2025-01-01T00:00:00Z',
      nonce: 'abc123',
    };

    const canonical1 = canonicalizePayload(payload);
    // Keys should be alphabetically sorted
    const parsed = JSON.parse(canonical1);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());

    // Same payload in different key order should produce same result
    const payload2 = {
      nonce: 'abc123',
      timestamp: '2025-01-01T00:00:00Z',
      v: 1 as const,
      machineId: 'machine-1',
      projectId: 'proj-1',
      nodeId: 'node-1',
    };
    expect(canonicalizePayload(payload2)).toBe(canonical1);
  });

  it('generates a 64-character hex nonce', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    // Each nonce should be unique
    expect(generateNonce()).not.toBe(nonce);
  });

  // Crypto.subtle tests only work in environments that support it
  // (Node 20+ with --experimental-global-webcrypto, or browsers)
  it('roundtrip sign/verify', async () => {
    const keyPair = await generateDispatchKeyPair();

    const payload: DispatchSigningPayload = {
      v: 1,
      nodeId: 'node-1',
      projectId: 'proj-1',
      machineId: 'machine-1',
      timestamp: new Date().toISOString(),
      nonce: generateNonce(),
    };

    const signature = await signDispatchIntent(keyPair.privateKey, payload);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');

    // Verify with the public key
    const canonical = new TextEncoder().encode(
      JSON.stringify(payload, Object.keys(payload).sort())
    );

    // Decode base64url signature
    const sigBinary = atob(signature.replace(/-/g, '+').replace(/_/g, '/'));
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.publicKey,
      sigBytes,
      canonical
    );
    expect(valid).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const keyPair = await generateDispatchKeyPair();

    const payload: DispatchSigningPayload = {
      v: 1,
      nodeId: 'node-1',
      projectId: 'proj-1',
      machineId: 'machine-1',
      timestamp: new Date().toISOString(),
      nonce: generateNonce(),
    };

    const signature = await signDispatchIntent(keyPair.privateKey, payload);

    // Tamper with the payload
    const tampered = { ...payload, machineId: 'evil-machine' };
    const tamperedCanonical = new TextEncoder().encode(
      JSON.stringify(tampered, Object.keys(tampered).sort())
    );

    const sigBinary = atob(signature.replace(/-/g, '+').replace(/_/g, '/'));
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.publicKey,
      sigBytes,
      tamperedCanonical
    );
    expect(valid).toBe(false);
  });

  it('exports public key as JWK', async () => {
    const keyPair = await generateDispatchKeyPair();
    const jwk = await exportPublicKeyJWK(keyPair.publicKey);

    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.x).toBeTruthy();
    expect(jwk.y).toBeTruthy();
    // Public key should not have private component
    expect(jwk.d).toBeUndefined();
  });
});
