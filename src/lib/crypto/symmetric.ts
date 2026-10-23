/**
 * Symmetric encryption helpers for OAuth token storage.
 *
 * Uses AES-256-GCM (authenticated encryption) — the GCM tag detects
 * tampering, so a row that's been edited in the DB will fail to decrypt
 * loudly rather than silently producing garbage.
 *
 * Ciphertext format: `iv:tag:ciphertext` (all hex). Keeps the layout
 * trivially inspectable in psql and easy to migrate later if needed.
 *
 * Key source: `process.env.OAUTH_ENCRYPTION_KEY` — must be a 64-char hex
 * string (32 bytes / 256 bits). Generate with: `openssl rand -hex 32`.
 *
 * This module deliberately does NOT roll its own crypto — it composes
 * Node's `crypto.createCipheriv` primitives with sensible defaults.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM authentication tag

/** Resolves and validates the encryption key. Throws on misconfiguration. */
function getKey(): Buffer {
  const raw = process.env.OAUTH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'OAUTH_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32, ' +
        'then add it to .env.local.',
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(raw.trim()))
    throw new Error('OAUTH_ENCRYPTION_KEY must be 32 bytes of hex');
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `OAUTH_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars). ` +
        `Got ${key.length} bytes. Regenerate with: openssl rand -hex 32.`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string. Returns `iv:tag:ciphertext` (all hex).
 * Each call produces a fresh random IV, so identical plaintexts yield
 * different ciphertexts — never reuse IVs with GCM.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() requires a string plaintext');
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a string produced by `encrypt()`. Throws if the ciphertext
 * is malformed, tampered, or encrypted with a different key.
 */
export function decrypt(ciphertext: string): string {
  if (typeof ciphertext !== 'string') {
    throw new TypeError('decrypt() requires a string ciphertext');
  }
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format: expected iv:tag:ciphertext (3 hex segments)');
  }
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth tag length: expected ${TAG_BYTES} bytes, got ${tag.length}`);
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Sanity self-check — round-trips a known plaintext. Used by tests
 * and can be invoked at startup if you want fail-fast misconfiguration.
 */
export function selfTest(): boolean {
  const sample = `cocoa-ai-oauth-selftest-${Date.now()}`;
  const encrypted = encrypt(sample);
  const decrypted = decrypt(encrypted);
  return decrypted === sample;
}
