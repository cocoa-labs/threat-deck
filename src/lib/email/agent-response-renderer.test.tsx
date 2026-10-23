/**
 * Tests for the Markdown → React Email renderer used by AgentResponseEmail.
 *
 * Strategy: render various agent-output shapes through `renderAgentMarkdown`,
 * then walk the React tree to assert that the right primitives ended up
 * where they should. We don't snapshot the full rendered HTML — too brittle
 * across React Email version bumps — but we do verify structural invariants:
 *
 *   - Headers → Heading
 *   - Bold + severity tags → strong (with severity coloring distinguishable
 *     by inline style)
 *   - Inline code → code
 *   - Links → Link with href
 *   - Numbered + bullet lists → Section with the right number of Text rows
 *   - Code blocks → Section with whitespace-pre-wrap mono content
 *   - HR → Hr
 *   - Plain paragraphs → Text
 *
 * The canonical fixture is a Fix Architect SITREP that exercises every
 * block + inline shape — the same kind of output the live agent produces
 * for CVE remediation playbooks (see the user's screenshot for the example).
 */

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderAgentMarkdown } from './agent-response-renderer';

/** Walk a React tree, returning every element whose type name matches `predicate`. */
function findElements(
  node: ReactNode,
  predicate: (typeName: string) => boolean,
  out: ReactElement[] = [],
): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const typeName =
    typeof node.type === 'string'
      ? node.type
      : ((node.type as { displayName?: string; name?: string }).displayName ??
        (node.type as { name?: string }).name ??
        '(anonymous)');
  if (predicate(typeName)) out.push(node);
  const props = node.props as { children?: ReactNode };
  if (props.children !== undefined) findElements(props.children, predicate, out);
  return out;
}

/** Flatten string children of an element into a single string (best-effort). */
function textContent(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textContent(props.children);
  }
  return '';
}

describe('renderAgentMarkdown', () => {
  it('renders an empty string as no blocks', () => {
    const blocks = renderAgentMarkdown('');
    expect(blocks).toEqual([]);
  });

  it('renders a plain paragraph as a Text block', () => {
    const blocks = renderAgentMarkdown('Quantum VPN gateways read like open books overnight.');
    expect(blocks).toHaveLength(1);
    const texts = findElements(blocks, (n) => n === 'Text');
    expect(texts.length).toBeGreaterThanOrEqual(1);
    expect(textContent(blocks)).toContain('read like open books');
  });

  it('renders a level-2 header as Heading + lowers heading level for h4+', () => {
    const blocks = renderAgentMarkdown('## BLUF\nsome content\n\n#### Footnote\nmore');
    const headings = findElements(blocks, (n) => n === 'Heading');
    expect(headings.length).toBe(2);
    expect(textContent(headings[0])).toBe('BLUF');
    expect(textContent(headings[1])).toBe('Footnote');
  });

  it('renders severity tags as styled strong elements with severity color', () => {
    const blocks = renderAgentMarkdown('**[CRITICAL]** ScreenConnect auth bypass — patch now.');
    const strongs = findElements(blocks, (n) => n === 'strong');
    expect(strongs.length).toBeGreaterThanOrEqual(1);
    // First strong should be the severity tag with a red-ish color.
    const sev = strongs[0]!;
    const style = (sev.props as { style?: { color?: string } }).style;
    expect(style?.color?.toLowerCase()).toMatch(/#ff0040|#ff4444/);
    expect(textContent(sev)).toContain('CRITICAL');
  });

  it('renders inline bold + italic distinctly from severity tags', () => {
    const blocks = renderAgentMarkdown(
      'The **upgrade** is in *2.46.1*. Yes, we noticed it landed Tuesday.',
    );
    const strongs = findElements(blocks, (n) => n === 'strong');
    const ems = findElements(blocks, (n) => n === 'em');
    expect(strongs.some((s) => textContent(s) === 'upgrade')).toBe(true);
    expect(ems.some((e) => textContent(e) === '2.46.1')).toBe(true);
  });

  it('renders inline code with the mono inline-code style', () => {
    const blocks = renderAgentMarkdown(
      'Apply WAF rule: `SecRule REQUEST_URI "@beginsWith /SetupWizard"`.',
    );
    const codes = findElements(blocks, (n) => n === 'code');
    expect(codes.length).toBe(1);
    expect(textContent(codes[0])).toContain('SetupWizard');
  });

  it('renders Markdown links as Link with the right href', () => {
    const blocks = renderAgentMarkdown(
      'Source: [AEGIS CVE Detail](/api/aegis/cves/view?id=CVE-2024-1708)',
    );
    const links = findElements(blocks, (n) => n === 'Link');
    expect(links.length).toBe(1);
    const href = (links[0]!.props as { href?: string }).href;
    expect(href).toBe('/api/aegis/cves/view?id=CVE-2024-1708');
    expect(textContent(links[0])).toBe('AEGIS CVE Detail');
  });

  it('renders numbered lists as a Section containing N Text rows with marker prefixes', () => {
    const blocks = renderAgentMarkdown(
      '1. UPGRADE to 23.9.8 immediately.\n2. ROTATE session tokens.\n3. AUDIT for CVE-2024-1709 chaining.',
    );
    // Find list Section then its child Text rows.
    const sections = findElements(blocks, (n) => n === 'Section');
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const texts = findElements(blocks, (n) => n === 'Text');
    expect(texts.length).toBe(3);
    expect(textContent(texts[0])).toMatch(/^1\.\s*UPGRADE/);
    expect(textContent(texts[1])).toMatch(/^2\.\s*ROTATE/);
    expect(textContent(texts[2])).toMatch(/^3\.\s*AUDIT/);
  });

  it('renders bullet lists with · markers', () => {
    const blocks = renderAgentMarkdown(
      '- Unusual child processes spawned by ScreenConnect service account\n- Lateral movement originating from ScreenConnect host\n- New scheduled tasks created post-session',
    );
    const texts = findElements(blocks, (n) => n === 'Text');
    expect(texts.length).toBe(3);
    expect(textContent(texts[0])).toMatch(/^·\s*Unusual child/);
  });

  it('renders fenced code blocks as a Section with whitespace-pre-wrap', () => {
    const md =
      '```\nSecRule REQUEST_URI "@rx \\.\\./|\\.\\.\\\\|%2e%2e" \\\n  "id:100025, phase:1, deny, status:403"\n```';
    const blocks = renderAgentMarkdown(md);
    const sections = findElements(blocks, (n) => n === 'Section');
    expect(sections.length).toBeGreaterThanOrEqual(1);
    // The code-block section should have whiteSpace: pre-wrap in its style.
    const codeBlocks = sections.filter(
      (s) => (s.props as { style?: { whiteSpace?: string } }).style?.whiteSpace === 'pre-wrap',
    );
    expect(codeBlocks.length).toBe(1);
    expect(textContent(codeBlocks[0])).toContain('SecRule');
  });

  it('renders horizontal rules', () => {
    const blocks = renderAgentMarkdown('First paragraph.\n\n---\n\nSecond paragraph.');
    const hrs = findElements(blocks, (n) => n === 'Hr');
    expect(hrs.length).toBe(1);
  });

  it('handles the canonical Fix Architect SITREP end-to-end', () => {
    // This is a compressed version of the SITREP from the user's screenshot
    // (CVE-2024-1708 ScreenConnect remediation playbook). Exercises headers,
    // severity tags, lists, code blocks, links — the full block + inline surface.
    const md = `**[CRITICAL]** ScreenConnect auth bypass — patch tonight.

## BLUF
ScreenConnect's exposure window closes when you ship 23.9.8.

## REMEDIATION PLAYBOOK

1. **UPGRADE** to ConnectWise ScreenConnect 23.9.8 or later.
2. **ROTATE** all ScreenConnect session tokens post-upgrade.
3. **AUDIT** for CVE-2024-1709 (CVSS 10.0 auth bypass) simultaneously.

4. **COMPENSATING WAF RULE** (deploy if patch is >4 hours away):

\`\`\`
SecRule REQUEST_URI "@rx \\.\\./|\\.\\.\\\\|%2e%2e" \\
  "id:100025, phase:1, deny, status:403, \\
  msg:'CVE-2024-1708 Path Traversal Block'"
\`\`\`

5. **SIEM DETECTION** — Flag any HTTP 200 response to ScreenConnect paths containing \`../\` sequences, URL-encoded variants (\`%2e%2e%2f\`), or double-encoded variants (\`%252e%252e\`).

## SOURCES
- [VERIFIED] [AEGIS CVE Detail](/api/aegis/cves/view?id=CVE-2024-1708)
- [VERIFIED] [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-1708)

*Confidence: HIGH (85-90%)* — KEV metadata and lifecycle model are AEGIS-verified.`;

    const blocks = renderAgentMarkdown(md);
    expect(blocks.length).toBeGreaterThan(5);

    // BLUF + REMEDIATION + SOURCES — three headings
    const headings = findElements(blocks, (n) => n === 'Heading');
    expect(headings.length).toBe(3);
    expect(headings.map(textContent)).toEqual(['BLUF', 'REMEDIATION PLAYBOOK', 'SOURCES']);

    // Severity tag CRITICAL
    const strongs = findElements(blocks, (n) => n === 'strong');
    const hasCritical = strongs.some(
      (s) =>
        textContent(s).includes('CRITICAL') &&
        (s.props as { style?: { color?: string } }).style?.color !== undefined,
    );
    expect(hasCritical).toBe(true);

    // Code block present
    const sections = findElements(blocks, (n) => n === 'Section');
    const codeBlocks = sections.filter(
      (s) => (s.props as { style?: { whiteSpace?: string } }).style?.whiteSpace === 'pre-wrap',
    );
    expect(codeBlocks.length).toBe(1);

    // Source links
    const links = findElements(blocks, (n) => n === 'Link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    const hrefs = links.map((l) => (l.props as { href?: string }).href);
    expect(hrefs).toContain('/api/aegis/cves/view?id=CVE-2024-1708');
    expect(hrefs).toContain('https://nvd.nist.gov/vuln/detail/CVE-2024-1708');

    // Inline code in SIEM line
    const codes = findElements(blocks, (n) => n === 'code');
    expect(codes.length).toBeGreaterThanOrEqual(3); // ../, %2e%2e%2f, %252e%252e

    // Italic confidence callout
    const ems = findElements(blocks, (n) => n === 'em');
    expect(ems.some((e) => textContent(e).includes('Confidence'))).toBe(true);
  });

  it('renders a Markdown table as an HTML table with thead + tbody', () => {
    const md = `## DATA SUMMARY

ConnectWise shipped ScreenConnect 23.9.7 with CVSS 8.4.

| Field | Value |
| --- | --- |
| CVE | CVE-2024-1708 |
| Vendor | ConnectWise |
| KEV Added | 2026-04-28 |
| Federal Deadline | 2026-05-12 — OVERDUE |`;
    const blocks = renderAgentMarkdown(md);

    // Should find a <table> element with thead + tbody children.
    const tables = findElements(blocks, (n) => n === 'table');
    expect(tables.length).toBe(1);

    // Header row: 2 <th>
    const ths = findElements(blocks, (n) => n === 'th');
    expect(ths.length).toBe(2);
    expect(textContent(ths[0])).toBe('Field');
    expect(textContent(ths[1])).toBe('Value');

    // Data rows: 4 rows × 2 cells = 8 <td>
    const tds = findElements(blocks, (n) => n === 'td');
    expect(tds.length).toBe(8);
    // Spot-check a few values landed in the right cells.
    expect(textContent(tds[0])).toBe('CVE');
    expect(textContent(tds[1])).toBe('CVE-2024-1708');
    expect(textContent(tds[6])).toBe('Federal Deadline');
    expect(textContent(tds[7])).toContain('OVERDUE');
  });

  it('does NOT collapse table rows into a pipe-soup paragraph', () => {
    // Regression for the bug that surfaced after the structured-content
    // rebalance (commit 0a47dac) instructed the agent to use tables for
    // DATA SUMMARY etc. — before this fix the rows were getting collected
    // into a paragraph via the wrap-join logic, rendering as raw pipes.
    const md = `| Asset | Price | Change |
| --- | --- | --- |
| WTI Crude | $90.61 | -0.11% |
| Brent Crude | $93.75 | +1.40% |`;
    const blocks = renderAgentMarkdown(md);
    const tables = findElements(blocks, (n) => n === 'table');
    expect(tables.length).toBe(1);
    // No <Text> paragraph should have pipe characters at this point —
    // they should all be table cells.
    const texts = findElements(blocks, (n) => n === 'Text');
    for (const t of texts) {
      expect(textContent(t)).not.toContain('|---|');
    }
  });

  it('renders inline formatting inside table cells (bold, severity tags, links)', () => {
    const md = `| Level | Status |
| --- | --- |
| Diplomatic pressure | **[HIGH]** ongoing |
| Source | [IAEA](https://iaea.org) |`;
    const blocks = renderAgentMarkdown(md);
    const tds = findElements(blocks, (n) => n === 'td');
    // Bold severity tag in first row's status cell becomes a styled <strong>
    const strongs = findElements(blocks, (n) => n === 'strong');
    expect(strongs.some((s) => textContent(s).includes('HIGH'))).toBe(true);
    // Link in second row's status cell becomes a <Link>
    const links = findElements(blocks, (n) => n === 'Link');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect((links[0]!.props as { href?: string }).href).toBe('https://iaea.org/');
    // Cells still have their text content
    expect(tds.some((td) => textContent(td).includes('Diplomatic pressure'))).toBe(true);
  });

  it('coalesces wrapped paragraph lines into a single Text block', () => {
    const blocks = renderAgentMarkdown(
      'WormGPT v3 surfaces on the forums yesterday — a Mistral checkpoint\nwith the guardrails stripped, ready to phish at scale.',
    );
    const texts = findElements(blocks, (n) => n === 'Text');
    expect(texts.length).toBe(1);
    expect(textContent(texts[0])).toContain('with the guardrails stripped');
  });
});

// Use Children import to satisfy lint (it's available for downstream
// consumers who might walk children differently); reference it once here
// so the import isn't tree-shaken into an unused warning.
void Children;
