/**
 * Shared style tokens for Cocoa AI Threat Deck email templates.
 * Mirrors the in-app CRT aesthetic — dark base, Matrix green brand accent,
 * Geist Mono fallback chain for monospace headers.
 *
 * Severity colors match `tokens.css` so the email rendering matches the dashboard.
 */
export const emailTheme = {
  bgOuter: '#0a0a0a',
  bgCard: '#141414',
  bgSubtle: '#1a1a1a',
  border: '#2a2a2a',
  textPrimary: '#e8e8e8',
  textSecondary: '#a8a8a8',
  textMuted: '#6a6a6a',
  matrixGreen: '#00ff41',
  brandAccent: '#00ff41',
  severity: {
    critical: '#ff0040',
    high: '#ff4444',
    medium: '#ffaa00',
    low: '#00ff41',
  },
  fontMono: "'SF Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",
  fontSans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

export type EmailSeverity = 'critical' | 'high' | 'medium' | 'low';

export function severityColor(severity: string | null | undefined): string {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return emailTheme.severity.critical;
  if (s === 'high') return emailTheme.severity.high;
  if (s === 'medium') return emailTheme.severity.medium;
  if (s === 'low') return emailTheme.severity.low;
  return emailTheme.textMuted;
}

/**
 * Build an absolute URL for a given path. Uses `EMAIL_LINK_BASE_URL` if set
 * (e.g. `https://deck.example.org`), then `NEXTAUTH_URL`, falling back to
 * the local dev port. Email clients require fully-qualified URLs in <a> tags.
 */
export function absoluteUrl(path: string): string {
  const base =
    process.env.EMAIL_LINK_BASE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3002';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = base.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
