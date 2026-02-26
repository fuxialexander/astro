/**
 * Dispatch Signing — Browser-side ECDSA P-256 signing
 *
 * Generates keypairs, signs dispatch intents, and manages keys in IndexedDB.
 * Agent runners verify these signatures to ensure dispatches originated from
 * the user's browser, not from a compromised server.
 */

/** Payload signed by the user's browser to prove dispatch authenticity */
export interface DispatchSigningPayload {
  /** Schema version */
  v: 1;
  /** Which task (plan node) */
  nodeId: string;
  /** Which project */
  projectId: string;
  /** Target machine (prevents redirection) */
  machineId: string;
  /** ISO 8601 timestamp (prevents replay) */
  timestamp: string;
  /** Random 32-byte hex nonce (prevents replay) */
  nonce: string;
}

const DB_NAME = 'astro-dispatch-keys';
const STORE_NAME = 'keys';
const DB_VERSION = 1;

/**
 * Open (or create) the IndexedDB database for dispatch signing keys.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generate an ECDSA P-256 keypair for dispatch signing.
 * The private key is non-extractable for security.
 */
export async function generateDispatchKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable private key
    ['sign', 'verify']
  );
}

/**
 * Export a public key as JWK for transmission to the server/agent runner.
 */
export async function exportPublicKeyJWK(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/**
 * Store a signing keypair in IndexedDB, keyed by userId.
 */
export async function storeSigningKey(userId: string, keyPair: CryptoKeyPair): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(keyPair, userId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve the full signing keypair for a user from IndexedDB.
 */
export async function getSigningKeyPair(userId: string): Promise<CryptoKeyPair | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(userId);
      request.onsuccess = () => {
        const keyPair = request.result as CryptoKeyPair | undefined;
        resolve(keyPair ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // IndexedDB unavailable (e.g., incognito mode in some browsers)
    return null;
  }
}

/**
 * Retrieve the signing private key for a user from IndexedDB.
 */
export async function getSigningPrivateKey(userId: string): Promise<CryptoKey | null> {
  const keyPair = await getSigningKeyPair(userId);
  return keyPair?.privateKey ?? null;
}

/**
 * Deterministic JSON serialization of a DispatchSigningPayload.
 * Keys are sorted alphabetically for consistent hashing.
 */
export function canonicalizePayload(payload: DispatchSigningPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Generate a random 32-byte hex nonce.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Base64url encode a buffer (no padding).
 */
function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign a dispatch intent with the user's ECDSA P-256 private key.
 * Returns a base64url-encoded signature.
 */
export async function signDispatchIntent(
  privateKey: CryptoKey,
  payload: DispatchSigningPayload
): Promise<string> {
  const canonical = canonicalizePayload(payload);
  const encoded = new TextEncoder().encode(canonical);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoded
  );
  return base64urlEncode(signature);
}
