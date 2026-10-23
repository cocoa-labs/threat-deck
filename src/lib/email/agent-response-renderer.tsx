import { safeLink } from '@/lib/security/safe-link';
/**
 * Phase 13 Tier 5 — Markdown → React Email renderer for the AgentResponseEmail
 * template. Takes the agent's raw SITREP output (Markdown with cyber-thriller
 * register baked in via SOUL.md) and converts it to React Email primitives
 * that preserve the editorial structure in the inbox:
 *
 *   ## BLUF              → Heading (h2, matrix-green uppercase)
 *   **[CRITICAL]** xyz   → severity-colored bold inline
 *   **bold**             → <strong>
 *   *italic / Confidence*→ <em> (muted secondary text)
 *   `inline code`        → <code> (mono font, subtle bg)
 *   [text](url)          → <Link> (matrix-green)
 *   ```code block```     → <Section> with mono font + bordered bg
 *   1. / - list items    → indented <Text> with marker prefix
 *   ---                  → <Hr>
 *   horizontal whitespace→ <Text> paragraphs split on blank lines
 *
 * Scope is pragmatic: covers the ~95% of agent output shapes seen in actual
 * SITREP traffic (see the test fixture for the canonical Fix Architect
 * remediation playbook). The 5% edge cases (nested lists, blockquotes,
 * tables) fall through to plain-text <Text> with newline preservation —
 * never breaks, just renders less prettily.
 *
 * NOT a general-purpose Markdown engine — don't pull in remark/marked. The
 * agent's output is constrained by the SOUL.md output discipline, so the
 * input shape is predictable and a tight purpose-built renderer is more
 * maintainable than a Markdown lib's full feature surface.
 */

import { Heading, Hr, Link, Section, Text } from '@react-email/components';
import type { ReactElement } from 'react';
import { emailTheme, severityColor } from './templates/theme';

/** Match severity tags like **[CRITICAL]** / **[HIGH]** / **[MEDIUM]** etc. */
const SEVERITY_TAG_RE = /\*\*\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\*\*/gi;
/** Inline patterns inside a paragraph: bold, italic, code, link. */
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /(?<![*])\*([^*]+)\*(?![*])/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const HEADER_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```/;
const HR_RE = /^---+$/;
const NUMBERED_LIST_RE = /^(\d+)[.)]\s+(.*)$/;
const BULLET_LIST_RE = /^[-*]\s+(.*)$/;
/** Pipe-delimited Markdown table row — `| col | col | col |` (with at
 *  least one `|` boundary). Tolerant of leading/trailing whitespace. */
const TABLE_ROW_RE = /^\s*\|.+\|\s*$/;
/** Markdown table separator row — `| --- | :---: | ---: |` etc. Allows
 *  optional `:` alignment markers per CommonMark/GFM. */
const TABLE_SEP_RE = /^\s*\|[\s\-:|]+\|\s*$/;

const styles = {
  heading: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    fontWeight: 700 as const,
    letterSpacing: '0.14em',
    margin: '20px 0 8px',
    textTransform: 'uppercase' as const,
  },
  subheading: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.10em',
    margin: '16px 0 6px',
    textTransform: 'uppercase' as const,
  },
  paragraph: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '14px',
    lineHeight: '1.6',
    margin: '0 0 10px',
  },
  listItem: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '14px',
    lineHeight: '1.55',
    margin: '0 0 4px',
    paddingLeft: '4px',
  },
  marker: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontWeight: 700 as const,
    marginRight: '8px',
  },
  codeBlock: {
    background: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.border}`,
    borderLeft: `2px solid ${emailTheme.matrixGreen}`,
    borderRadius: '3px',
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    lineHeight: '1.5',
    margin: '8px 0 12px',
    padding: '10px 12px',
    whiteSpace: 'pre-wrap' as const,
  },
  inlineCode: {
    background: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.border}`,
    borderRadius: '2px',
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    padding: '1px 4px',
  },
  link: {
    color: emailTheme.matrixGreen,
    textDecoration: 'underline',
  },
  tableWrap: {
    margin: '8px 0 14px',
  },
  table: {
    borderCollapse: 'collapse' as const,
    width: '100%',
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
  },
  th: {
    background: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.border}`,
    borderBottom: `2px solid ${emailTheme.matrixGreen}`,
    color: emailTheme.matrixGreen,
    fontWeight: 700 as const,
    letterSpacing: '0.06em',
    padding: '6px 10px',
    textAlign: 'left' as const,
    textTransform: 'uppercase' as const,
  },
  td: {
    background: emailTheme.bgCard,
    border: `1px solid ${emailTheme.border}`,
    color: emailTheme.textPrimary,
    padding: '6px 10px',
    textAlign: 'left' as const,
    verticalAlign: 'top' as const,
  },
  hr: {
    border: 'none',
    borderTop: `1px solid ${emailTheme.border}`,
    margin: '16px 0',
  },
} as const;

/**
 * Render a single inline string with bold / italic / code / link / severity-tag
 * formatting. Returns an array of React nodes (strings + element fragments).
 * Order of pass matters: severity tags before generic bold so the color hint
 * wins over the plain-bold style.
 */
function renderInline(input: string, keyPrefix: string): (string | ReactElement)[] {
  // Tokenize into segments by collecting non-overlapping matches across all
  // inline patterns. Each segment becomes one node; in between sits plain
  // text. We collect all matches with their indices, sort by start, then walk.
  interface Hit {
    start: number;
    end: number;
    node: ReactElement;
  }
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;

  // Severity tags first (must precede generic bold scan).
  SEVERITY_TAG_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = SEVERITY_TAG_RE.exec(input)) !== null) {
    const sev = m[1]!.toLowerCase();
    const color = severityColor(sev);
    const idx = hits.length;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <strong
          key={`${keyPrefix}-sev-${idx}`}
          style={{
            background: `${color}1a`,
            border: `1px solid ${color}`,
            borderRadius: '2px',
            color,
            fontFamily: emailTheme.fontMono,
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '1px 5px',
            textTransform: 'uppercase',
          }}
        >
          [{m[1]}]
        </strong>
      ),
    });
  }

  // Links — convert before bold so [text](url) inside ** ** wraps inside the link
  LINK_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = LINK_RE.exec(input)) !== null) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    const idx = hits.length;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <Link key={`${keyPrefix}-link-${idx}`} href={safeLink(m[2])} style={styles.link}>
          {m[1]}
        </Link>
      ),
    });
  }

  // Inline code
  INLINE_CODE_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = INLINE_CODE_RE.exec(input)) !== null) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    const idx = hits.length;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <code key={`${keyPrefix}-code-${idx}`} style={styles.inlineCode}>
          {m[1]}
        </code>
      ),
    });
  }

  // Bold (skip if overlaps a severity tag already captured)
  BOLD_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = BOLD_RE.exec(input)) !== null) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    const idx = hits.length;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <strong
          key={`${keyPrefix}-bold-${idx}`}
          style={{ color: emailTheme.textPrimary, fontWeight: 700 }}
        >
          {m[1]}
        </strong>
      ),
    });
  }

  // Italic (single * not adjacent to another *)
  ITALIC_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = ITALIC_RE.exec(input)) !== null) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    const idx = hits.length;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      node: (
        <em
          key={`${keyPrefix}-em-${idx}`}
          style={{ color: emailTheme.textSecondary, fontStyle: 'italic' }}
        >
          {m[1]}
        </em>
      ),
    });
  }

  if (hits.length === 0) return [input];

  // Walk segments in order, filling plain-text gaps between captured nodes.
  hits.sort((a, b) => a.start - b.start);
  const nodes: (string | ReactElement)[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) nodes.push(input.slice(cursor, h.start));
    nodes.push(h.node);
    cursor = h.end;
  }
  if (cursor < input.length) nodes.push(input.slice(cursor));
  return nodes;
}

function overlaps(hits: { start: number; end: number }[], start: number, end: number): boolean {
  for (const h of hits) {
    if (start < h.end && end > h.start) return true;
  }
  return false;
}

/**
 * Parse a Markdown table row `| col1 | col2 | col3 |` into its trimmed cell
 * strings. Strips the leading/trailing pipe; does not handle escaped pipes
 * (the agent doesn't produce them). Empty cells preserved as empty strings.
 */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Strip a single leading + trailing `|` if present so we don't get empty
  // first/last cells from `| a | b |` → `['', 'a', 'b', '']` shape.
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const stripped = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return stripped.split('|').map((c) => c.trim());
}

/**
 * Render the agent's Markdown SITREP into an array of React Email
 * block-level elements. Pure function; no I/O.
 */
export function renderAgentMarkdown(md: string): ReactElement[] {
  const out: ReactElement[] = [];
  const lines = md.split('\n');
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Skip blank lines (they're paragraph separators, handled by the
    // paragraph collector below).
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(trimmed)) {
      out.push(<Hr key={`hr-${blockKey++}`} style={styles.hr} />);
      i += 1;
      continue;
    }

    // Header (## BLUF, etc.) — level 2 is the most common, but render h1-h3
    // distinctly. h4+ collapses to the subheading register.
    const headerMatch = line.match(HEADER_RE);
    if (headerMatch) {
      const level = headerMatch[1]!.length;
      const text = headerMatch[2]!;
      const isTopLevel = level <= 3;
      const style = isTopLevel ? styles.heading : styles.subheading;
      const tag = `h${Math.min(level, 4)}` as const as 'h1' | 'h2' | 'h3' | 'h4';
      out.push(
        <Heading as={tag} key={`h-${blockKey++}`} style={style}>
          {renderInline(text, `h-${blockKey}`)}
        </Heading>,
      );
      i += 1;
      continue;
    }

    // Fenced code block
    if (FENCE_RE.test(trimmed)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test((lines[i] ?? '').trim())) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      // skip the closing fence
      if (i < lines.length) i += 1;
      out.push(
        <Section key={`code-${blockKey++}`} style={styles.codeBlock}>
          {codeLines.join('\n')}
        </Section>,
      );
      continue;
    }

    // Markdown table — header row + separator row + data rows. Detected when
    // the current line is a pipe-delimited row AND the next line is a
    // separator (dashes/colons/pipes). Renders as a proper HTML table with
    // the CRT chrome (mono font, matrix-green header underline). The
    // structured-content rebalance (commit 0a47dac in SOUL.md) explicitly
    // tells the agent to use tables for DATA SUMMARY / MITRE MAPPING /
    // LIFECYCLE STATE etc., so the renderer MUST handle them — otherwise
    // tables collapse into pipe-soup paragraphs.
    if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator
      const dataRows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? '')) {
        dataRows.push(parseTableRow(lines[i] ?? ''));
        i += 1;
      }
      const tableKey = blockKey++;
      out.push(
        <Section key={`table-${tableKey}`} style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {headerCells.map((cell, idx) => (
                  <th key={`th-${tableKey}-${idx}`} style={styles.th}>
                    {renderInline(cell, `th-${tableKey}-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, rowIdx) => (
                <tr key={`tr-${tableKey}-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td key={`td-${tableKey}-${rowIdx}-${cellIdx}`} style={styles.td}>
                      {renderInline(cell, `td-${tableKey}-${rowIdx}-${cellIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>,
      );
      continue;
    }

    // Numbered or bullet list — collect contiguous items until a blank line
    // or a non-list line, then render as a single Section.
    const listMatch = trimmed.match(NUMBERED_LIST_RE) ?? trimmed.match(BULLET_LIST_RE);
    if (listMatch) {
      const items: { marker: string; text: string }[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        if (t.length === 0) break;
        const num = t.match(NUMBERED_LIST_RE);
        const bul = t.match(BULLET_LIST_RE);
        if (num) {
          items.push({ marker: `${num[1]}.`, text: num[2]! });
          i += 1;
          continue;
        }
        if (bul) {
          items.push({ marker: '·', text: bul[1]! });
          i += 1;
          continue;
        }
        break;
      }
      out.push(
        <Section key={`list-${blockKey++}`} style={{ margin: '0 0 12px' }}>
          {items.map((item, idx) => (
            <Text key={`li-${blockKey}-${idx}`} style={styles.listItem}>
              <span style={styles.marker}>{item.marker}</span>
              {renderInline(item.text, `li-${blockKey}-${idx}`)}
            </Text>
          ))}
        </Section>,
      );
      continue;
    }

    // Paragraph — collect contiguous non-empty, non-block lines
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim();
      if (t.length === 0) break;
      if (HEADER_RE.test(t)) break;
      if (HR_RE.test(t)) break;
      if (FENCE_RE.test(t)) break;
      if (NUMBERED_LIST_RE.test(t) || BULLET_LIST_RE.test(t)) break;
      // Stop at table rows so an orphan table row (e.g., one without a
      // separator below it, or one we somehow missed) doesn't get sucked
      // into the paragraph and rendered as pipe-soup prose.
      if (TABLE_ROW_RE.test(t)) break;
      paraLines.push(t);
      i += 1;
    }
    const paragraphText = paraLines.join(' ');
    out.push(
      <Text key={`p-${blockKey++}`} style={styles.paragraph}>
        {renderInline(paragraphText, `p-${blockKey}`)}
      </Text>,
    );
  }

  return out;
}
