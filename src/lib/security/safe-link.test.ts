import { expect, it } from 'vitest';
import { safeLink } from './safe-link';

it.each([
  'javascript:alert(1)',
  'data:text/html,evil',
  '//attacker.example',
  'https://user:password@example.org',
  'java\nscript:alert(1)',
  '/\\evil',
])('rejects unsafe rendered link %s', (value) => expect(safeLink(value)).toBe('#'));
it('retains citations and public web links', () => {
  expect(safeLink('/api/aegis/cves/view?id=CVE-2024-3094')).toContain('/api/aegis/');
  expect(safeLink('https://example.org/report')).toBe('https://example.org/report');
});
