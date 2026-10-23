import type { ErrorEvent } from 'react-map-gl/mapbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMapboxError, dedupeKey } from './error-classify';

/**
 * Build a minimal ErrorEvent. classifyMapboxError only reads
 * evt.error.{message,name,status,url}, so a partial object cast is sufficient
 * and mirrors what react-map-gl forwards from the raw mapbox-gl error event.
 */
function evt(error: unknown): ErrorEvent {
  return { type: 'error', target: {}, error } as unknown as ErrorEvent;
}

describe('classifyMapboxError', () => {
  it('classifies a failed satellite tile fetch as transient', () => {
    expect(
      classifyMapboxError(
        evt({
          message:
            'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/7/78/52.webp?sku=abc&access_token=pk.x',
          name: 'Error',
        }),
      ),
    ).toBe('transient');
  });

  it('classifies a bare network TypeError as transient', () => {
    expect(classifyMapboxError(evt({ message: 'Failed to fetch', name: 'TypeError' }))).toBe(
      'transient',
    );
  });

  it('classifies the Safari "Load failed" variant as transient', () => {
    expect(classifyMapboxError(evt({ message: 'Load failed' }))).toBe('transient');
  });

  it('classifies an AbortError as transient', () => {
    expect(
      classifyMapboxError(evt({ message: 'signal is aborted without reason', name: 'AbortError' })),
    ).toBe('transient');
  });

  it('classifies HTTP 429 as transient', () => {
    expect(classifyMapboxError(evt({ message: 'Too Many Requests', status: 429 }))).toBe(
      'transient',
    );
  });

  it('classifies HTTP 5xx as transient', () => {
    expect(classifyMapboxError(evt({ message: 'Service Unavailable', status: 503 }))).toBe(
      'transient',
    );
  });

  it('classifies a 401 status as auth', () => {
    expect(classifyMapboxError(evt({ message: 'Unauthorized', status: 401 }))).toBe('auth');
  });

  it('classifies an invalid-token message with no status as auth', () => {
    expect(
      classifyMapboxError(
        evt({
          message:
            'Unauthorized: you may have provided an invalid Mapbox access token. See https://docs.mapbox.com',
        }),
      ),
    ).toBe('auth');
  });

  it('classifies a 403 status as auth', () => {
    expect(classifyMapboxError(evt({ message: 'Forbidden', status: 403 }))).toBe('auth');
  });

  it('classifies an "access token" message as auth', () => {
    expect(classifyMapboxError(evt({ message: 'access token is required' }))).toBe('auth');
  });

  it('prioritizes auth over transient for a 401 on a tile URL', () => {
    expect(
      classifyMapboxError(
        evt({
          message: 'Unauthorized',
          status: 401,
          url: 'https://api.mapbox.com/v4/mapbox.satellite/7/78/52.webp',
        }),
      ),
    ).toBe('auth');
  });

  it('classifies a style/paint expression error (BUG-010) as fatal', () => {
    expect(
      classifyMapboxError(
        evt({
          message:
            'Expected at most 1 argument, but found 2 instead. "interpolate" expression may only be used as input to a top-level "step" or "interpolate" expression.',
        }),
      ),
    ).toBe('fatal');
  });

  it('classifies a generic style error as fatal', () => {
    expect(
      classifyMapboxError(
        evt({ message: 'layers.threat-ring.paint.circle-color: Expected color but found number' }),
      ),
    ).toBe('fatal');
  });

  it('classifies a missing error object as fatal', () => {
    expect(classifyMapboxError(evt(undefined))).toBe('fatal');
  });
});

describe('dedupeKey', () => {
  it('collapses different tile coords and query strings to the same key', () => {
    const a = dedupeKey(
      'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/7/78/52.webp?sku=AAA&access_token=pk.x',
    );
    const b = dedupeKey(
      'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/8/79/53.webp?sku=BBB&access_token=pk.y',
    );
    expect(a).toBe(b);
  });
});

describe('reportMapboxError', () => {
  // The throttle map is module-scoped — reset modules before each test so the
  // throttle window starts empty and tests don't bleed into one another.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a transient error via console.warn once, never console.error', async () => {
    const { reportMapboxError } = await import('./error-classify');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportMapboxError(
      '[MapCanvas]',
      evt({
        message: 'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/7/78/52.webp?sku=x',
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toBe('[MapCanvas]');
  });

  it('throttles repeated transient tile failures to a single warn', async () => {
    const { reportMapboxError } = await import('./error-classify');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportMapboxError(
      '[MapCanvas]',
      evt({
        message: 'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/7/78/52.webp?sku=a',
      }),
    );
    reportMapboxError(
      '[MapCanvas]',
      evt({
        message: 'Failed to fetch https://api.mapbox.com/v4/mapbox.satellite/8/79/53.webp?sku=b',
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a fatal error via console.error, never console.warn', async () => {
    const { reportMapboxError } = await import('./error-classify');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportMapboxError(
      '[MapCanvas]',
      evt({
        message:
          '"interpolate" expression may only be used as input to a top-level "step" or "interpolate" expression.',
      }),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not log auth errors — the caller surfaces those via setMapError', async () => {
    const { reportMapboxError } = await import('./error-classify');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportMapboxError('[MapCanvas]', evt({ message: 'Unauthorized', status: 401 }));

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
