import { vi } from 'vitest';

// Business-logic tests mock the security boundary; security regressions unmock
// the module they exercise. Provider calls never leave this test process.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    throw new Error('Unmocked network in test');
  }),
);
vi.mock('@/lib/security/route-policy', () => ({
  withRoutePolicy: (_path: string, handler: unknown) => handler,
}));
vi.mock('@/lib/security/safe-fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  validatePublicUrl: async (url: string) => new URL(url),
}));
vi.mock('@/lib/security/budget', () => ({
  reserveBudget: async () => async () => {},
  budgetedAIFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));
vi.mock('@/lib/storage/private-files', () => ({
  privateBlobResponse: (url: string) => fetch(url),
}));
// These fixtures exercise configured capabilities. Defaults are tested with
// flags removed in security/capabilities.test.ts and container smoke tests.
for (const flag of [
  'ENABLE_AI',
  'ENABLE_OUTBOUND_EMAIL',
  'ENABLE_X_PUBLISHING',
  'ENABLE_GMAIL_ACCESS',
  'ENABLE_MEDIA_GENERATION',
  'ENABLE_AUTOMATION',
  'ENABLE_PUBLIC_FEED',
]) {
  process.env[flag] = 'true';
}

process.env.TWITTER_OAUTH_HANDLE = 'example-monitor';
process.env.CRON_SECRET = 'test-cron-secret-with-at-least-32-characters';
