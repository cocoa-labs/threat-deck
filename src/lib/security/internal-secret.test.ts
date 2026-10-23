/**
 * The Vercel↔Fly trust boundary. Everything guarding the video executor routes
 * lives in this one function and it had zero coverage — including the specific
 * question of whether an UNSET secret on the Vercel side (which makes the
 * remote provider send an empty header) could match an unset secret on the
 * worker and fail open.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyInternalRenderSecret } from './internal-secret';

const SECRET = 'a'.repeat(64);

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://worker.test/api/internal/video/start', { headers });
}

describe('verifyInternalRenderSecret', () => {
  const original = process.env.INTERNAL_RENDER_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_RENDER_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.INTERNAL_RENDER_SECRET;
    else process.env.INTERNAL_RENDER_SECRET = original;
  });

  it('accepts the matching secret', () => {
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': SECRET }))).toEqual({
      ok: true,
    });
  });

  it('rejects a missing header', () => {
    expect(verifyInternalRenderSecret(req())).toEqual({ ok: false, status: 401 });
  });

  it('rejects an EMPTY header — the value Vercel sends when its own secret is unset', () => {
    // This is the fail-open scenario: empty provided vs configured expected.
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': '' }))).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('rejects a same-length mismatch', () => {
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': 'b'.repeat(64) }))).toEqual(
      { ok: false, status: 401 },
    );
  });

  it('rejects a different-length value without throwing in timingSafeEqual', () => {
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': 'short' }))).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('fails CLOSED with 503 when the worker has no secret configured', () => {
    // Critically: an unconfigured worker must not accept an empty header.
    delete process.env.INTERNAL_RENDER_SECRET;
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': '' }))).toEqual({
      ok: false,
      status: 503,
    });
    expect(verifyInternalRenderSecret(req())).toEqual({ ok: false, status: 503 });
  });

  it('treats a whitespace-only configured secret as unconfigured', () => {
    process.env.INTERNAL_RENDER_SECRET = '   ';
    expect(verifyInternalRenderSecret(req({ 'x-internal-render-secret': '   ' }))).toEqual({
      ok: false,
      status: 503,
    });
  });
});
