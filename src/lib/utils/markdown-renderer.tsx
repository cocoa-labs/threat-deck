import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Database,
  ExternalLink,
  Info,
  Shield,
  TrendingUp,
} from 'lucide-react';
import type React from 'react';
import { safeLink } from '@/lib/security/safe-link';

/* ─── Severity badge rendering ─── */

export const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: 'rgba(255, 0, 64, 0.15)',
    text: 'var(--severity-critical)',
    border: 'rgba(255, 0, 64, 0.3)',
  },
  HIGH: {
    bg: 'rgba(255, 68, 68, 0.12)',
    text: 'var(--severity-high)',
    border: 'rgba(255, 68, 68, 0.25)',
  },
  MEDIUM: {
    bg: 'rgba(255, 170, 0, 0.12)',
    text: 'var(--severity-medium)',
    border: 'rgba(255, 170, 0, 0.25)',
  },
  LOW: {
    bg: 'rgba(0, 255, 65, 0.12)',
    text: 'var(--severity-low)',
    border: 'rgba(0, 255, 65, 0.25)',
  },
  INFO: {
    bg: 'rgba(102, 102, 102, 0.12)',
    text: 'var(--severity-info)',
    border: 'rgba(102, 102, 102, 0.25)',
  },
};

export function SeverityBadge({ level }: { level: string }) {
  const style = SEVERITY_STYLES[level] ?? SEVERITY_STYLES.INFO!;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider"
      style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      {level === 'CRITICAL' || level === 'HIGH' ? (
        <AlertTriangle size={8} />
      ) : level === 'LOW' || level === 'INFO' ? (
        <Info size={8} />
      ) : (
        <Shield size={8} />
      )}
      {level}
    </span>
  );
}

/* ─── Confidence badge rendering ─── */

export function ConfidenceBadge({ pct }: { pct: string }) {
  const num = Number.parseInt(pct, 10);
  const color =
    num >= 80
      ? 'var(--color-positive)'
      : num >= 50
        ? 'var(--color-warning)'
        : 'var(--color-negative)';
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-mono tracking-wider"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {pct}%
    </span>
  );
}

/* ─── Citation tier badge rendering ─── */

export const CITATION_TIER_STYLES: Record<
  string,
  { bg: string; text: string; border: string; icon: 'check' | 'database' | 'alert' }
> = {
  VERIFIED: {
    bg: 'rgba(68, 255, 136, 0.12)',
    text: 'var(--color-positive)',
    border: 'rgba(68, 255, 136, 0.25)',
    icon: 'check',
  },
  RECALLED: {
    bg: 'rgba(102, 102, 102, 0.12)',
    text: 'var(--text-dim)',
    border: 'rgba(102, 102, 102, 0.25)',
    icon: 'database',
  },
  ASSESSED: {
    bg: 'rgba(255, 170, 0, 0.12)',
    text: 'var(--color-warning)',
    border: 'rgba(255, 170, 0, 0.25)',
    icon: 'alert',
  },
};

export function CitationTierBadge({ tier }: { tier: string }) {
  const style = CITATION_TIER_STYLES[tier] ?? CITATION_TIER_STYLES.ASSESSED!;
  const Icon =
    style.icon === 'check' ? CheckCircle : style.icon === 'database' ? Database : AlertTriangle;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider"
      style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      <Icon size={8} />
      {tier}
    </span>
  );
}

/* ─── Data table renderer ─── */

export function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.2)' }}>
            {headers.map((h, ci) => (
              <th
                key={`h-${ci}-${h.trim()}`}
                className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider"
                style={{ color: 'var(--crt-glow)' }}
              >
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={`r${ri}-${row[0]?.trim().slice(0, 10) ?? ri}`}
              className="transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}
            >
              {row.map((cell, ci) => (
                <td
                  key={`r${ri}-c${ci}-${cell.trim().slice(0, 10)}`}
                  className="px-2 py-1 text-[var(--text-secondary)]"
                >
                  {renderInlineFormatting(cell.trim())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Section config for SITREP section cards ─── */

const SECTION_CONFIG: Record<
  string,
  {
    accent: string;
    bg: string;
    border: string;
    icon: typeof Database;
  }
> = {
  'DATA SUMMARY': {
    accent: 'var(--crt-glow)',
    bg: 'rgba(var(--crt-glow-rgb), 0.04)',
    border: 'rgba(var(--crt-glow-rgb), 0.2)',
    icon: Database,
  },
  'KEY FINDINGS': {
    accent: 'var(--color-warning)',
    bg: 'rgba(255, 170, 0, 0.04)',
    border: 'rgba(255, 170, 0, 0.2)',
    icon: AlertTriangle,
  },
  'MARKET IMPACT': {
    accent: 'var(--color-positive)',
    bg: 'rgba(68, 255, 136, 0.04)',
    border: 'rgba(68, 255, 136, 0.2)',
    icon: TrendingUp,
  },
  'RISK ASSESSMENT': {
    accent: 'var(--color-negative)',
    bg: 'rgba(255, 68, 68, 0.04)',
    border: 'rgba(255, 68, 68, 0.2)',
    icon: Shield,
  },
};

/* ─── BlufCard — Hero treatment for the BLUF ─── */

export function BlufCard({
  children,
  reactKey,
}: {
  children: React.ReactNode;
  reactKey: string | number;
}) {
  const accent = 'var(--crt-glow)';
  return (
    <div
      key={reactKey}
      className="rounded-lg font-mono overflow-hidden my-2"
      style={{
        background: 'rgba(var(--crt-glow-rgb), 0.04)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.2)',
        boxShadow: `0 0 12px color-mix(in srgb, ${accent} 6%, transparent), inset 0 1px 0 color-mix(in srgb, ${accent} 6%, transparent)`,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-1.5"
        style={{
          background: `color-mix(in srgb, ${accent} 6%, transparent)`,
          borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.2)',
        }}
      >
        <ChevronRight size={10} style={{ color: accent }} />
        <span
          className="text-[9px] font-bold uppercase tracking-[0.15em]"
          style={{
            color: accent,
            textShadow: `0 0 8px color-mix(in srgb, ${accent} 25%, transparent)`,
          }}
        >
          BLUF
        </span>
      </div>
      <div className="px-3 py-2 text-[var(--text-primary)]">{children}</div>
    </div>
  );
}

/* ─── SectionCard — Wrapper for SITREP sections ─── */

function SectionCard({
  sectionId,
  label,
  children,
  reactKey,
}: {
  sectionId: string;
  label: string;
  children: React.ReactNode;
  reactKey: string | number;
}) {
  const cfg = SECTION_CONFIG[sectionId];
  if (!cfg) return <>{children}</>;

  const Icon = cfg.icon;
  return (
    <div
      key={reactKey}
      className="rounded-lg font-mono overflow-hidden my-2"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 12px color-mix(in srgb, ${cfg.accent} 6%, transparent), inset 0 1px 0 color-mix(in srgb, ${cfg.accent} 6%, transparent)`,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-1.5"
        style={{
          background: `color-mix(in srgb, ${cfg.accent} 6%, transparent)`,
          borderBottom: `1px solid ${cfg.border}`,
        }}
      >
        <Icon size={10} style={{ color: cfg.accent }} />
        <span
          className="text-[9px] font-bold uppercase tracking-[0.15em]"
          style={{
            color: cfg.accent,
            textShadow: `0 0 8px color-mix(in srgb, ${cfg.accent} 25%, transparent)`,
          }}
        >
          {label}
        </span>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

/* ─── FindingCard — Severity-accented mini card for findings ─── */

function FindingCard({
  severity,
  children,
  reactKey,
}: {
  severity: string;
  children: React.ReactNode;
  reactKey: string | number;
}) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.INFO!;
  return (
    <div
      key={reactKey}
      className="rounded-r pl-3 py-1.5 ml-1 my-0.5"
      style={{
        borderLeft: `2px solid ${style.text}`,
        background: style.bg,
      }}
    >
      <span className="text-[var(--text-secondary)]">{children}</span>
    </div>
  );
}

/* ─── CodeBlock — Fenced code blocks ─── */

function FencedCodeBlock({
  language,
  code,
  reactKey,
}: {
  language: string;
  code: string;
  reactKey: string | number;
}) {
  return (
    <div
      key={reactKey}
      className="rounded-lg overflow-hidden my-2 font-mono"
      style={{
        background: 'rgba(var(--crt-glow-rgb), 0.04)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
      }}
    >
      {language && (
        <div
          className="flex justify-end px-2 py-1"
          style={{
            borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.1)',
          }}
        >
          <span
            className="rounded px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider"
            style={{
              color: 'var(--crt-glow)',
              background: 'rgba(var(--crt-glow-rgb), 0.08)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
            }}
          >
            {language}
          </span>
        </div>
      )}
      <pre
        className="overflow-x-auto px-3 py-2 text-[9px] leading-relaxed"
        style={{ color: 'var(--crt-glow)', whiteSpace: 'pre' }}
      >
        {code}
      </pre>
    </div>
  );
}

/* ─── BlockquoteBlock — Quote block for > syntax ─── */

function BlockquoteBlock({
  children,
  reactKey,
}: {
  children: React.ReactNode;
  reactKey: string | number;
}) {
  return (
    <div
      key={reactKey}
      className="pl-3 py-1 my-1 rounded-r"
      style={{
        borderLeft: '2px solid rgba(var(--crt-glow-rgb), 0.3)',
        background: 'rgba(var(--crt-glow-rgb), 0.03)',
      }}
    >
      <div className="text-[var(--text-dim)]">{children}</div>
    </div>
  );
}

/* ─── SourceCitationPill — Enhanced inline source citation ─── */

function SourceCitationPill({
  children,
  reactKey,
}: {
  children: React.ReactNode;
  reactKey: number;
}) {
  return (
    <span
      key={reactKey}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px]"
      style={{
        background: 'rgba(102, 102, 102, 0.08)',
        border: '1px solid rgba(102, 102, 102, 0.12)',
      }}
    >
      {children}
    </span>
  );
}

/* ─── Inline formatting: bold, italic, code, links, URLs, severity badges, confidence, tickers, source citations ─── */

export function renderInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Extended regex: source citations, severity/citation badges, confidence scores, markdown links, bold, italic, code, bare URLs, bare citation tiers
  const regex =
    /(\*\(Source:\s*(.+?)\)\*|\*\*\[(CRITICAL|HIGH|MEDIUM|LOW|INFO|VERIFIED|RECALLED|ASSESSED)\]\*\*|\*Confidence:\s*(\d+)%\*|\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|(https?:\/\/[^\s)]+)|\[(VERIFIED|RECALLED|ASSESSED)\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  // biome-ignore lint/suspicious/noAssignInExpressions: established regex exec pattern
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t${key}`}>{colorizeNumbers(text.slice(lastIndex, match.index), key)}</span>,
      );
      key++;
    }

    if (match[2]) {
      // Source citation pill *(Source: ...)*
      parts.push(
        <SourceCitationPill key={key} reactKey={key}>
          {renderInlineFormatting(match[2])}
        </SourceCitationPill>,
      );
      key++;
    } else if (match[3]) {
      const level = match[3];
      if (level === 'VERIFIED' || level === 'RECALLED' || level === 'ASSESSED') {
        // Citation tier badge **[VERIFIED]** etc.
        parts.push(<CitationTierBadge key={key++} tier={level} />);
      } else {
        // Severity badge **[CRITICAL]** etc.
        parts.push(<SeverityBadge key={key++} level={level} />);
      }
    } else if (match[4]) {
      // Confidence score *Confidence: XX%*
      parts.push(<ConfidenceBadge key={key++} pct={match[4]} />);
    } else if (match[5] && match[6]) {
      // [text](url) markdown link
      parts.push(
        <a
          key={key++}
          href={safeLink(match[6])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 hover:underline"
          style={{ color: 'var(--crt-glow)' }}
        >
          {match[5]}
          <ExternalLink size={8} className="inline shrink-0 opacity-60" />
        </a>,
      );
    } else if (match[7]) {
      // **bold** — recurse so nested links/badges still render
      parts.push(
        <strong key={key++} className="font-semibold text-[var(--text-primary)]">
          {renderInlineFormatting(match[7])}
        </strong>,
      );
    } else if (match[8]) {
      // *italic* — recurse so nested links/citations still render
      parts.push(
        <em key={key++} className="italic text-[var(--text-dim)]">
          {renderInlineFormatting(match[8])}
        </em>,
      );
    } else if (match[9]) {
      // `code`
      parts.push(
        <code
          key={key++}
          className="rounded px-1 py-0.5 text-[9px]"
          style={{
            background: 'rgba(var(--crt-glow-rgb), 0.08)',
            color: 'var(--crt-glow)',
            border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
          }}
        >
          {match[9]}
        </code>,
      );
    } else if (match[10]) {
      // bare URL
      parts.push(
        <a
          key={key++}
          href={safeLink(match[10])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 hover:underline"
          style={{ color: 'var(--crt-glow)' }}
        >
          {match[10].length > 40 ? `${match[10].slice(0, 40)}...` : match[10]}
          <ExternalLink size={8} className="inline shrink-0 opacity-60" />
        </a>,
      );
    } else if (match[11]) {
      // Bare citation tier [VERIFIED] etc. (without bold wrapping — fallback)
      parts.push(<CitationTierBadge key={key++} tier={match[11]} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`e${key}`}>{colorizeNumbers(text.slice(lastIndex), key)}</span>);
  }

  if (parts.length === 0) return colorizeNumbers(text, 0);
  return parts;
}

/** Colorize inline percentages and dollar amounts (green for +, red for -) */
export function colorizeNumbers(text: string, baseKey: number): React.ReactNode {
  const numRegex = /([+-]\d+\.?\d*%|\$[\d,.]+(?:\s*[+-]\d+\.?\d*%)?)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = baseKey;

  // biome-ignore lint/suspicious/noAssignInExpressions: established regex exec pattern
  while ((match = numRegex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const val = match[1]!;
    const isPositive = val.includes('+');
    const isNegative = val.includes('-');
    const color = isPositive
      ? 'var(--color-positive)'
      : isNegative
        ? 'var(--color-negative)'
        : 'var(--text-primary)';
    parts.push(
      <span key={`n${key++}`} className="font-semibold tabular-nums" style={{ color }}>
        {val}
      </span>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length > 1 ? parts : text;
}

/* ─── Known SITREP section headers ─── */

const KNOWN_SECTIONS = new Set(Object.keys(SECTION_CONFIG));

/* ─── CRT-styled markdown renderer ─── */

export function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  // Section accumulator for SITREP card wrapping
  let currentSection: { id: string; label: string; lines: React.ReactNode[] } | null = null;

  // Code block accumulator
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let codeBlockStart = 0;

  // BLUF accumulator
  let inBluf = false;
  let blufLines: React.ReactNode[] = [];
  let blufStart = 0;

  /** Push accumulated section content as a SectionCard to elements */
  function flushSection() {
    if (currentSection) {
      elements.push(
        <SectionCard
          key={`sec-${currentSection.id}-${elements.length}`}
          reactKey={`sec-${currentSection.id}-${elements.length}`}
          sectionId={currentSection.id}
          label={currentSection.label}
        >
          {currentSection.lines}
        </SectionCard>,
      );
      currentSection = null;
    }
  }

  /** Push accumulated BLUF content as a BlufCard to elements */
  function flushBluf() {
    if (inBluf && blufLines.length > 0) {
      const target = currentSection ? currentSection.lines : elements;
      target.push(
        <BlufCard key={`bluf-${blufStart}`} reactKey={`bluf-${blufStart}`}>
          {blufLines}
        </BlufCard>,
      );
    }
    inBluf = false;
    blufLines = [];
  }

  /** Route an element to the current section or top-level elements */
  function emit(node: React.ReactNode) {
    if (currentSection) {
      currentSection.lines.push(node);
    } else {
      elements.push(node);
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // ── 1. Fenced code blocks ──
    if (!inCodeBlock && line.trim().startsWith('```')) {
      codeBlockLang = line.trim().slice(3).trim();
      codeBlockLines = [];
      codeBlockStart = i;
      inCodeBlock = true;
      i++;
      continue;
    }

    if (inCodeBlock) {
      if (line.trim() === '```') {
        // Close code block
        emit(
          <FencedCodeBlock
            key={`code-${codeBlockStart}`}
            reactKey={`code-${codeBlockStart}`}
            language={codeBlockLang}
            code={codeBlockLines.join('\n')}
          />,
        );
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
        i++;
        continue;
      }
      codeBlockLines.push(line);
      i++;
      continue;
    }

    // ── 2. BLUF detection: **BLUF:** at line start ──
    if (line.match(/^\*\*BLUF:\*\*/i)) {
      flushBluf(); // flush any prior BLUF
      inBluf = true;
      blufStart = i;
      // Extract inline content after **BLUF:**
      const blufInline = line.replace(/^\*\*BLUF:\*\*\s*/i, '').trim();
      if (blufInline) {
        blufLines.push(
          <div key={`bluf-l-${i}`} className="py-0.5">
            {renderInlineFormatting(blufInline)}
          </div>,
        );
      }
      i++;
      continue;
    }

    // ── 2b. BLUF continuation: accumulate non-blank, non-header, non-HR lines ──
    if (inBluf) {
      if (line.trim() === '' || line.match(/^#{1,4}\s+/) || /^---+$/.test(line.trim())) {
        flushBluf();
        // Don't continue — fall through to process this line normally
      } else {
        blufLines.push(
          <div key={`bluf-l-${i}`} className="py-0.5">
            {renderInlineFormatting(line)}
          </div>,
        );
        i++;
        continue;
      }
    }

    // ── 3. Blank line ──
    if (line.trim() === '') {
      emit(<div key={i} className="h-1.5" />);
      i++;
      continue;
    }

    // ── 4. Horizontal rule — glowing CRT divider ──
    if (/^---+$/.test(line.trim())) {
      emit(
        <div
          key={i}
          className="my-3 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(var(--crt-glow-rgb), 0.3), transparent)',
            boxShadow: '0 0 4px rgba(var(--crt-glow-rgb), 0.15)',
          }}
        />,
      );
      i++;
      continue;
    }

    // ── 5. Markdown table detection: | col | col | ──
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim().startsWith('|') &&
        (lines[i] ?? '').trim().endsWith('|')
      ) {
        tableLines.push(lines[i]!);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) => row.split('|').slice(1, -1);
        const headers = parseRow(tableLines[0]!);
        const startRow = /^\s*[-:| ]+\s*$/.test(tableLines[1] ?? '') ? 2 : 1;
        const rows = tableLines.slice(startRow).map(parseRow);
        emit(<DataTable key={`table-${i}`} headers={headers} rows={rows} />);
      }
      continue;
    }

    // ── 6. ## Headers — section-aware routing ──
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1]!.length;
      const content = headerMatch[2]!;

      if (level <= 2) {
        // Check for BLUF header
        if (content.trim().toUpperCase() === 'BLUF') {
          flushSection();
          flushBluf();
          // Start BLUF accumulation — next lines will be BLUF content
          inBluf = true;
          blufStart = i;
          i++;
          continue;
        }

        // Check for known SITREP section
        const sectionKey = content.trim().toUpperCase();
        if (KNOWN_SECTIONS.has(sectionKey)) {
          flushBluf();
          flushSection();
          currentSection = { id: sectionKey, label: content.trim(), lines: [] };
          i++;
          continue;
        }

        // Regular ## header — flush section first
        flushBluf();
        flushSection();
        emit(
          <div key={i} className="mt-3 mb-1.5">
            <div
              className="text-[11px] font-mono font-bold uppercase tracking-[0.2em]"
              style={{
                color: 'var(--crt-glow)',
                textShadow: '0 0 8px rgba(var(--crt-glow-rgb), 0.3)',
              }}
            >
              {renderInlineFormatting(content)}
            </div>
            <div
              className="mt-1 h-px"
              style={{
                background:
                  'linear-gradient(90deg, rgba(var(--crt-glow-rgb), 0.3), transparent 80%)',
              }}
            />
          </div>,
        );
      } else {
        // Sub-headers (### and ####)
        emit(
          <div
            key={i}
            className="mt-2 mb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-primary)]"
          >
            {renderInlineFormatting(content)}
          </div>,
        );
      }
      i++;
      continue;
    }

    // ── 7. Blockquotes — > prefixed lines ──
    if (line.match(/^>\s?/)) {
      const quoteLines: React.ReactNode[] = [];
      const quoteStart = i;
      while (i < lines.length && (lines[i] ?? '').match(/^>\s?/)) {
        const quoteContent = (lines[i] ?? '').replace(/^>\s?/, '');
        quoteLines.push(
          <div key={`bq-l-${i}`} className="py-0.5">
            {renderInlineFormatting(quoteContent)}
          </div>,
        );
        i++;
      }
      emit(
        <BlockquoteBlock key={`bq-${quoteStart}`} reactKey={`bq-${quoteStart}`}>
          {quoteLines}
        </BlockquoteBlock>,
      );
      continue;
    }

    // ── 8. Numbered list items ──
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      emit(
        <div key={i} className="flex gap-2 pl-1 py-0.5">
          <span
            className="shrink-0 text-[var(--crt-glow)] font-semibold tabular-nums"
            style={{ opacity: 0.6, fontSize: '10px' }}
          >
            {numberedMatch[1]}.
          </span>
          <span className="text-[var(--text-secondary)]">
            {renderInlineFormatting(numberedMatch[2]!)}
          </span>
        </div>,
      );
      i++;
      continue;
    }

    // ── 9. Bullet list items — with FindingCard for severity-tagged bullets ──
    if (line.match(/^[-*]\s+/)) {
      const content = line.replace(/^[-*]\s+/, '');

      // Check for severity-tagged finding: **[CRITICAL|HIGH|MEDIUM|LOW|INFO]**
      const severityMatch = content.match(/^\*\*\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\*\*/);
      if (severityMatch) {
        emit(
          <FindingCard key={i} reactKey={i} severity={severityMatch[1]!}>
            {renderInlineFormatting(content)}
          </FindingCard>,
        );
      } else {
        emit(
          <div key={i} className="flex gap-2 pl-1 py-0.5">
            <span
              className="shrink-0 mt-[5px] h-1 w-1 rounded-full"
              style={{
                background: 'var(--crt-glow)',
                boxShadow: '0 0 4px rgba(var(--crt-glow-rgb), 0.4)',
              }}
            />
            <span className="text-[var(--text-secondary)]">{renderInlineFormatting(content)}</span>
          </div>,
        );
      }
      i++;
      continue;
    }

    // ── 10. Plain paragraph ──
    emit(
      <div key={i} className="text-[var(--text-secondary)] py-0.5">
        {renderInlineFormatting(line)}
      </div>,
    );
    i++;
  }

  // Flush any trailing accumulators
  flushBluf();
  flushSection();

  return elements;
}
