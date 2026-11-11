/**
 * Imhotep Browser Sync - Zero-Knowledge Client-Side E2EE Engine
 *
 * Implements military-grade, zero-knowledge encryption using the native
 * Web Cryptography API (crypto.subtle). Plaintext data never touches the wire
 * or persistent cloud storage unencrypted.
 *
 * Specifications:
 * - PBKDF2 key derivation (minimum 100,000 iterations, SHA-256, 16-byte random salt).
 * - AES-256-GCM authenticated encryption/decryption with unique 12-byte random IVs.
 * - Tamper-evident message validation via 128-bit authentication tags.
 */

import { EncryptedPayload, DerivedKeyResult, KeyDerivationOptions, PlaintextInput } from '../types/crypto';

/** Default PBKDF2 iterations exceeding NIST / OWASP guidelines */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
/** Standard AES-GCM IV byte length */
export const AES_GCM_IV_LENGTH = 12;
/** Standard PBKDF2 salt byte length */
export const PBKDF2_SALT_LENGTH = 16;
/** Current payload schema version */
export const E2EE_VERSION = 1;

/**
 * Converts a Uint8Array into a standard Base64 string safely across all bundle sizes.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks to prevent maximum call stack size exceeded
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string back into a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // Normalize URL-safe base64 if provided
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a cryptographically secure random salt (default 16 bytes).
 */
export function generateSalt(byteLength: number = PBKDF2_SALT_LENGTH): Uint8Array {
  const salt = new Uint8Array(byteLength);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Generates a cryptographically secure random Initialization Vector (12 bytes for AES-GCM).
 */
export function generateIV(): Uint8Array {
  const iv = new Uint8Array(AES_GCM_IV_LENGTH);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user master password or mnemonic phrase
 * using PBKDF2 with SHA-256 and at least 100,000 iterations.
 *
 * @param secret Master password, passphrase, or 12-word mnemonic seed.
 * @param options Key derivation configuration (salt, iterations, hash).
 */
export async function deriveKey(
  secret: string,
  options: KeyDerivationOptions = {}
): Promise<DerivedKeyResult> {
  if (!secret || secret.trim().length === 0) {
    throw new Error('Encryption secret cannot be empty');
  }

  const salt = options.salt || generateSalt(PBKDF2_SALT_LENGTH);
  const iterations = Math.max(options.iterations || DEFAULT_PBKDF2_ITERATIONS, DEFAULT_PBKDF2_ITERATIONS);
  const hash = options.hash || 'SHA-256';

  const encoder = new TextEncoder();
  const rawKeyData = encoder.encode(secret.normalize('NFKD'));

  // Import raw secret as PBKDF2 key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    rawKeyData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // Derive AES-GCM 256-bit key
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: iterations,
      hash: hash,
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // Do not allow key export from memory to protect against memory extraction
    ['encrypt', 'decrypt']
  );

  return {
    key: derivedKey,
    salt: salt,
    saltBase64: uint8ArrayToBase64(salt),
    iterations: iterations,
  };
}

/**
 * Convenience wrapper for deriving an AES-256-GCM key from a master password.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt?: Uint8Array | string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<DerivedKeyResult> {
  const resolvedSalt = typeof salt === 'string' ? base64ToUint8Array(salt) : salt;
  return deriveKey(password, { salt: resolvedSalt, iterations });
}

/**
 * Convenience wrapper for deriving an AES-256-GCM key from a 12-word mnemonic phrase.
 */
export async function deriveKeyFromMnemonic(
  mnemonic: string,
  salt?: Uint8Array | string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<DerivedKeyResult> {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  const resolvedSalt = typeof salt === 'string' ? base64ToUint8Array(salt) : salt;
  return deriveKey(normalizedMnemonic, { salt: resolvedSalt, iterations });
}

/**
 * Encrypts arbitrary data (string, JSON object, ArrayBuffer, Uint8Array) using AES-256-GCM.
 * A new, cryptographically secure 12-byte IV is generated for every invocation.
 *
 * @param data The plaintext data to encrypt.
 * @param key The derived AES-GCM 256-bit CryptoKey.
 * @param salt Optional PBKDF2 salt to embed in the payload envelope for portability.
 */
export async function encryptData(
  data: PlaintextInput,
  key: CryptoKey,
  salt?: Uint8Array | string
): Promise<EncryptedPayload> {
  let encodedBytes: Uint8Array;

  if (typeof data === 'string') {
    encodedBytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    encodedBytes = data;
  } else if (data instanceof ArrayBuffer) {
    encodedBytes = new Uint8Array(data);
  } else {
    // Objects, numbers, booleans -> serialized to JSON
    encodedBytes = new TextEncoder().encode(JSON.stringify(data));
  }

  const iv = generateIV();

  // AES-GCM encryption with 128-bit authentication tag appended
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      tagLength: 128,
    },
    key,
    encodedBytes as unknown as BufferSource
  );

  const ciphertextArray = new Uint8Array(ciphertextBuffer);
  const resolvedSalt = typeof salt === 'string' ? salt : salt ? uint8ArrayToBase64(salt) : undefined;

  return {
    ciphertext: uint8ArrayToBase64(ciphertextArray),
    iv: uint8ArrayToBase64(iv),
    salt: resolvedSalt,
    version: E2EE_VERSION,
  };
}

/**
 * Decrypts an AES-256-GCM EncryptedPayload back into its original plaintext type.
 * Automatically validates authentication tag; throws if tampered.
 *
 * @param payload EncryptedPayload structure or serialized bundle string.
 * @param key Derived AES-GCM 256-bit CryptoKey.
 */
export async function decryptData<T = unknown>(
  payload: EncryptedPayload | string,
  key: CryptoKey
): Promise<T> {
  const parsedPayload: EncryptedPayload =
    typeof payload === 'string' ? deserializePayload(payload) : payload;

  if (!parsedPayload.ciphertext || !parsedPayload.iv) {
    throw new Error('Invalid encrypted payload: missing ciphertext or iv');
  }

  const ciphertextBytes = base64ToUint8Array(parsedPayload.ciphertext);
  const ivBytes = base64ToUint8Array(parsedPayload.iv);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertextBytes as unknown as BufferSource
    );

    const decodedText = new TextDecoder().decode(decryptedBuffer);

    // Try parsing as JSON; if not valid JSON, return as string or raw
    try {
      return JSON.parse(decodedText) as T;
    } catch {
      return decodedText as unknown as T;
    }
  } catch (error) {
    throw new Error(
      `Decryption failed: Authentication tag verification failed or invalid key. (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  }
}

/**
 * Serializes an EncryptedPayload into a compact single string format:
 * `v<version>.<salt_b64>.<iv_b64>.<ciphertext_b64>`
 */
export function serializePayload(payload: EncryptedPayload): string {
  const salt = payload.salt || '';
  return `v${payload.version}.${salt}.${payload.iv}.${payload.ciphertext}`;
}

/**
 * Deserializes a compact bundle string back into an EncryptedPayload structure.
 */
export function deserializePayload(bundle: string): EncryptedPayload {
  if (bundle.startsWith('{')) {
    // Direct JSON serialized format
    return JSON.parse(bundle) as EncryptedPayload;
  }

  const parts = bundle.split('.');
  if (parts.length === 4 && parts[0].startsWith('v')) {
    const version = parseInt(parts[0].substring(1), 10) || 1;
    const salt = parts[1] || undefined;
    const iv = parts[2];
    const ciphertext = parts[3];
    return { version, salt, iv, ciphertext };
  }

  throw new Error('Unrecognized encrypted bundle format');
}

/**
 * Computes a SHA-256 hex digest of arbitrary text or bytes (e.g. for fingerprints or checksums).
 */
export async function computeSHA256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
