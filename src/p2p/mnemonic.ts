/**
 * Imhotep Browser Sync - BIP-39 Mnemonic & Pairing Code Engine
 *
 * Implements standard BIP-39 12-word mnemonic phrase generation, validation,
 * entropy conversion, and seed derivation using native Web Crypto APIs.
 *
 * Also provides compact human-readable pairing codes for seamless zero-knowledge
 * device-to-device authentication and discovery.
 */

import { BIP39_ENGLISH_WORDLIST, WORD_TO_INDEX_MAP } from './wordlist';

/**
 * Computes SHA-256 hash buffer of given bytes.
 */
async function sha256Buffer(bytes: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return new Uint8Array(hash);
}

/**
 * Converts a byte array to a string of binary digits ('0' and '1').
 */
function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += bytes[i].toString(2).padStart(8, '0');
  }
  return binary;
}

/**
 * Converts a string of binary digits ('0' and '1') to a Uint8Array.
 */
function binaryStringToBytes(binary: string): Uint8Array {
  const byteCount = Math.floor(binary.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = parseInt(binary.slice(i * 8, (i + 1) * 8), 2);
  }
  return bytes;
}

/**
 * Generates a standard BIP-39 12-word mnemonic phrase from 128 bits of
 * cryptographically secure random entropy.
 */
export async function generateMnemonic(): Promise<string> {
  // 128 bits = 16 bytes -> results in 12 words
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  return entropyToMnemonic(entropy);
}

/**
 * Converts a 16-byte (128-bit) entropy array into a 12-word BIP-39 mnemonic string.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  if (entropy.length !== 16 && entropy.length !== 32) {
    throw new Error(`Entropy length must be 16 or 32 bytes (got ${entropy.length})`);
  }

  const entropyBits = bytesToBinaryString(entropy);
  const checksumBitsCount = entropy.length * 8 / 32; // 4 bits for 128-bit entropy

  const hash = await sha256Buffer(entropy);
  const hashBits = bytesToBinaryString(hash);
  const checksum = hashBits.slice(0, checksumBitsCount);

  const combinedBits = entropyBits + checksum;
  const words: string[] = [];

  // Each word corresponds to 11 bits (2^11 = 2048 words)
  for (let i = 0; i < combinedBits.length; i += 11) {
    const chunk = combinedBits.slice(i, i + 11);
    const index = parseInt(chunk, 2);
    words.push(BIP39_ENGLISH_WORDLIST[index]);
  }

  return words.join(' ');
}

/**
 * Validates a BIP-39 mnemonic phrase (word correctness, word count, and checksum).
 */
export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  try {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      return false;
    }

    // Verify all words exist in wordlist
    for (const word of words) {
      if (WORD_TO_INDEX_MAP[word] === undefined) {
        return false;
      }
    }

    // Build binary string
    let combinedBits = '';
    for (const word of words) {
      const index = WORD_TO_INDEX_MAP[word];
      combinedBits += index.toString(2).padStart(11, '0');
    }

    const checksumLength = words.length === 12 ? 4 : 8;
    const entropyBitsLength = combinedBits.length - checksumLength;

    const entropyBits = combinedBits.slice(0, entropyBitsLength);
    const checksumBits = combinedBits.slice(entropyBitsLength);

    const entropy = binaryStringToBytes(entropyBits);
    const hash = await sha256Buffer(entropy);
    const hashBits = bytesToBinaryString(hash);

    return hashBits.slice(0, checksumLength) === checksumBits;
  } catch {
    return false;
  }
}

/**
 * Converts a verified 12-word mnemonic phrase back into its original 16-byte entropy.
 */
export async function mnemonicToEntropy(mnemonic: string): Promise<Uint8Array> {
  const isValid = await validateMnemonic(mnemonic);
  if (!isValid) {
    throw new Error('Invalid mnemonic phrase: check words and checksum');
  }

  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  let combinedBits = '';
  for (const word of words) {
    const index = WORD_TO_INDEX_MAP[word];
    combinedBits += index.toString(2).padStart(11, '0');
  }

  const checksumLength = words.length === 12 ? 4 : 8;
  const entropyBits = combinedBits.slice(0, combinedBits.length - checksumLength);
  return binaryStringToBytes(entropyBits);
}

/**
 * Derives a 512-bit (64-byte) binary seed from a mnemonic and optional passphrase
 * using PBKDF2 HMAC-SHA512 according to the BIP-39 specification.
 */
export async function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedPassphrase = passphrase.normalize('NFKD');

  const encoder = new TextEncoder();
  const passwordData = encoder.encode(normalizedMnemonic.normalize('NFKD'));
  const saltData = encoder.encode('mnemonic' + normalizedPassphrase);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltData,
      iterations: 2048,
      hash: 'SHA-512',
    },
    baseKey,
    512 // 512 bits = 64 bytes
  );

  return new Uint8Array(derivedBits);
}

/**
 * Derives a deterministic 6-character alphanumeric pairing fingerprint code
 * from a 12-word mnemonic (formatted e.g. 'IMH-4K9-X27').
 */
export async function derivePairingDisplayCode(mnemonic: string): Promise<string> {
  const seed = await mnemonicToSeed(mnemonic);
  const hash = await sha256Buffer(seed);
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 without confusing chars (0,1,I,O)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[hash[i] % alphabet.length];
  }
  return `IMH-${code.slice(0, 3)}-${code.slice(3, 6)}`;
}
