import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, selfTest } from './symmetric';

// A deterministic 32-byte hex key used only in tests.
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('symmetric crypto', () => {
  const originalKey = process.env.OAUTH_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.OAUTH_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OAUTH_ENCRYPTION_KEY;
    } else {
      process.env.OAUTH_ENCRYPTION_KEY = originalKey;
    }
  });

  it('round-trips a plaintext string', () => {
    const plain = 'hello-cocoa-ai-twitter-oauth-token';
    const cipher = encrypt(plain);
    expect(decrypt(cipher)).toBe(plain);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plain = 'same-input';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it('formats ciphertext as iv:tag:data (3 hex segments)', () => {
    const cipher = encrypt('x');
    const parts = cipher.split(':');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('throws when OAUTH_ENCRYPTION_KEY is missing', () => {
    delete process.env.OAUTH_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/OAUTH_ENCRYPTION_KEY/);
  });

  it('throws when OAUTH_ENCRYPTION_KEY is the wrong length', () => {
    process.env.OAUTH_ENCRYPTION_KEY = 'abcd'; // way too short
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });

  it('throws on tampered ciphertext (GCM auth tag mismatch)', () => {
    const cipher = encrypt('do not modify');
    // Flip a byte in the data segment.
    const parts = cipher.split(':');
    const dataHex = parts[2]!;
    const tamperedData = dataHex.startsWith('0') ? `1${dataHex.slice(1)}` : `0${dataHex.slice(1)}`;
    const tampered = `${parts[0]}:${parts[1]}:${tamperedData}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on malformed ciphertext (wrong segment count)', () => {
    expect(() => decrypt('not:enough')).toThrow(/iv:tag:ciphertext/);
  });

  it('selfTest() returns true with a valid key', () => {
    expect(selfTest()).toBe(true);
  });
});
