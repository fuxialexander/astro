/**
 * Client-side encryption utilities using Web Crypto API
 *
 * This module provides secure encryption/decryption for sensitive data like API keys.
 * Uses AES-GCM with 256-bit keys derived from user credentials via PBKDF2.
 *
 * Security considerations:
 * - Encryption happens entirely client-side before data leaves the browser
 * - Keys are derived from user email + a random salt (stored with encrypted data)
 * - Each encrypted value has a unique IV (initialization vector)
 * - Uses AES-GCM for authenticated encryption (provides both confidentiality and integrity)
 */

const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits recommended for AES-GCM
const PBKDF2_ITERATIONS = 100000
const SALT_LENGTH = 16

/**
 * Derive an encryption key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(password)

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  )

  // Derive AES key using PBKDF2
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false, // not extractable
    ["encrypt", "decrypt"]
  )
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Encrypt a plaintext string
 *
 * @param plaintext - The text to encrypt (e.g., an API key)
 * @param password - Password for key derivation (typically user email)
 * @returns Object containing encrypted data, IV, and salt (all base64-encoded)
 */
export async function encryptText(
  plaintext: string,
  password: string
): Promise<{ encrypted: string; iv: string; salt: string }> {
  if (!crypto.subtle) {
    throw new Error("Web Crypto API not available. Use HTTPS.")
  }

  const encoder = new TextEncoder()
  const plaintextBuffer = encoder.encode(plaintext)

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  // Derive encryption key
  const key = await deriveKey(password, salt)

  // Encrypt
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv,
    },
    key,
    plaintextBuffer
  )

  return {
    encrypted: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  }
}

/**
 * Decrypt an encrypted string
 *
 * @param encrypted - Base64-encoded encrypted data
 * @param iv - Base64-encoded initialization vector
 * @param salt - Base64-encoded salt used for key derivation (required)
 * @param password - Password for key derivation (typically user email)
 * @returns Decrypted plaintext string
 */
export async function decryptText(
  encrypted: string,
  iv: string,
  salt: string,
  password: string
): Promise<string> {
  if (!crypto.subtle) {
    throw new Error("Web Crypto API not available. Use HTTPS.")
  }

  if (!salt) {
    throw new Error("Salt is required for decryption")
  }

  // Convert from base64
  const encryptedBuffer = base64ToArrayBuffer(encrypted)
  const ivBuffer = new Uint8Array(base64ToArrayBuffer(iv))
  const saltBuffer = new Uint8Array(base64ToArrayBuffer(salt))

  // Derive decryption key (same as encryption key with same salt)
  const key = await deriveKey(password, saltBuffer)

  // Decrypt
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: ivBuffer,
    },
    key,
    encryptedBuffer
  )

  const decoder = new TextDecoder()
  return decoder.decode(decryptedBuffer)
}

/**
 * Get the user's password for encryption (typically their email)
 * This is used as the basis for key derivation.
 *
 * In a production system with WebAuthn, you might want to:
 * - Derive this from a WebAuthn credential
 * - Use a separate master password
 * - Store in secure session storage after authentication
 */
export async function getEncryptionPassword(userEmail: string): Promise<string> {
  // For now, use email as password
  // In production, consider deriving from WebAuthn credential or asking for a master password
  return userEmail
}
