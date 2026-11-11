/**
 * Imhotep Browser Sync - Cryptographic Type Definitions
 * Zero-Knowledge Client-Side End-to-End Encryption (E2EE)
 */

export interface EncryptedPayload {
  /** Base64-encoded AES-256-GCM ciphertext (includes 16-byte authentication tag appended by Web Crypto API) */
  ciphertext: string;
  /** Base64-encoded 12-byte initialization vector */
  iv: string;
  /** Base64-encoded PBKDF2 salt used during key derivation (optional if derived from persistent account salt) */
  salt?: string;
  /** Format / protocol version */
  version: number;
}

export interface KeyDerivationOptions {
  /** Salt used for PBKDF2. Must be cryptographically secure and >= 16 bytes */
  salt?: Uint8Array;
  /** Iteration count for PBKDF2. Minimum 100,000 for high security */
  iterations?: number;
  /** Hash digest algorithm. Default: 'SHA-256' */
  hash?: 'SHA-256' | 'SHA-512';
}

export interface DerivedKeyResult {
  key: CryptoKey;
  salt: Uint8Array;
  saltBase64: string;
  iterations: number;
}

export interface CryptoBundle {
  /** Serialized format string: v1.<salt_b64>.<iv_b64>.<ciphertext_b64> */
  rawBundle: string;
  payload: EncryptedPayload;
}

export type PlaintextInput = string | number | boolean | object | ArrayBuffer | Uint8Array;
