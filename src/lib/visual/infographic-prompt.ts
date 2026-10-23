import { STYLE_REGISTRY, type StyleTag } from './style-registry';
import type { VisualBrief } from './visual-brief';

const STYLE_DIRECTIVES: Record<StyleTag, string> = {
  kev_pressure:
    'KEV pressure layout: exploit-window poster with a vertical patch deadline rail, top severity meter, affected-product tile row, exposure/patch/telemetry modules, and a compact timeline. Hero motif: abstract countdown clock over network exposure lanes.',
  identity_intrusion:
    'Identity intrusion layout: account-plane investigation board with an inbox/OAuth path diagram, actor/campaign card, credential-flow modules, identity control checklist, and tenant audit timeline. Hero motif: anonymous silhouette plus account-node graph, never an identifiable person.',
  supply_chain_map:
    'Supply-chain map layout: dependency topology board with registry node map, propagation arrows, maintainer/developer impact cards, package table, and takedown timeline. Hero motif: package graph or repository lattice, no fake vendor logos.',
  research_gap_card:
    'Research gap layout: editorial analysis card with belief-versus-reality split, survey/research finding modules, executive takeaway block, source quotation card, and measured impact strip. Hero motif: annotated research paper and signal annotations.',
  exposure_ledger:
    'Exposure ledger layout: breach register with affected-party ledger columns, record/exposure tiles, vendor/customer blast-radius ring, response priority list, and disclosure timeline. Hero motif: audit ledger plus blast-radius accounting grid.',
  market_signal_board:
    'Market signal board layout: probability and market dashboard with chart-first composition, confidence interval strip, ticker/economic context tiles, scenario modules, and operator takeaway. Hero motif: compact trading terminal fused with cyber-risk monitor.',
  crt_terminal:
    'Fallback CRT terminal layout: dense situation-monitor surface with command prompt masthead, compact modular panels, source ticker, and restrained scanline texture. Use only when the story does not fit a stronger family.',
};

export function buildModelRenderedInfographicPrompt(
  brief: VisualBrief,
  styleTag: StyleTag,
): string {
  const style = STYLE_REGISTRY[styleTag];
  const payload = JSON.stringify(compactBrief(brief), null, 2);

  return `Create a complete vertical intelligence infographic for Cocoa AI Threat Deck.

OUTPUT:
- Single 1200x2400 PNG-style vertical poster.
- The image itself must contain the text, numbers, section labels, source footer, and infographic layout.
- Render text accurately and legibly. Preserve exact CVE IDs, dates, percentages, dollar amounts, ticker symbols, source names, and severity labels from the brief.

VISUAL SYSTEM:
- Brand: Cocoa AI // Threat Deck.
- Palette: near-black #0a0a0a, Matrix green #00ff41 brand seam, severity colors critical #ff0040, high #ff4444, medium #ffaa00, low #00ff41.
- Typography: compact terminal / Geist Mono feel, editorial but tactical. Use clear hierarchy, not decorative faux text.
- Composition: follow the selected template. Do not reuse the same masthead + severity rail + BLUF + metric-tile grid for every story.
- Density: information-rich but readable. Use panel grids, divider rules, small labels, and compact cards. Avoid large empty areas.
- Do not use generic cyber stock art, random code rain, illegible filler glyphs, fake logos, unrelated imagery, emojis, or decorative mascot characters.

TEMPLATE:
${STYLE_DIRECTIVES[styleTag]}
Overlay palette primary ${style.palette.primary}, secondary ${style.palette.secondary}, accent ${style.palette.accent}.

CONTENT BRIEF:
${payload}

STRICT RENDERING REQUIREMENTS:
- Use the brief as the source of truth.
- Do not invent facts, extra sources, organizations, numbers, dates, or claims.
- If a source URL is too long, show the source name/domain and keep the visible source footer compact.
- Keep all text within panel bounds. No overlapping labels. No misspelled masthead.
- The final result should feel like a premium AI-cyber intelligence surface, not a decorative poster.`;
}

export function buildSafetySoftenedInfographicPrompt(
  brief: VisualBrief,
  styleTag: StyleTag,
): string {
  const style = STYLE_REGISTRY[styleTag];
  const payload = JSON.stringify(sanitizeBriefForSafety(compactBrief(brief)), null, 2);

  return `Create a public-source security and geopolitical-risk infographic for Cocoa AI.

This is a defensive news-analysis graphic. It must not depict violence, weapons, gore, real people, national insignia, classified documents, operational instructions, or surveillance activity.

OUTPUT:
- Single 1200x2400 vertical PNG-style poster.
- The image itself should contain the sanitized text, metrics, section labels, source footer, and infographic layout.
- Render text accurately and legibly. Preserve dates, counts, percentages, and source counts from the sanitized brief.

VISUAL SYSTEM:
- Brand: Cocoa AI // Situation Monitor.
- Palette: near-black #0a0a0a, Matrix green #00ff41 brand seam, severity colors critical #ff0040, high #ff4444, medium #ffaa00, low #00ff41.
- Typography: compact terminal / Geist Mono feel, editorial but calm. Use clear hierarchy, not decorative faux text.
- Composition: follow the selected template family while keeping the safety-softened, public-source framing.
- Density: information-rich but readable. Use panel grids, divider rules, small labels, and compact cards. Avoid large empty areas.
- Keep imagery abstract: grids, maps-as-patterns, signal lines, charts, archival-paper texture, monitor UI. No people, weapons, explosions, crosshairs, national emblems, emojis, or mascot characters.

TEMPLATE:
Defensive public-source risk dashboard. Style family: ${style.label}. Palette primary ${style.palette.primary}, secondary ${style.palette.secondary}, accent ${style.palette.accent}.

SANITIZED CONTENT BRIEF:
${payload}

STRICT RENDERING REQUIREMENTS:
- Use the sanitized brief as the source of truth.
- Do not invent facts, extra sources, organizations, numbers, dates, or claims.
- If a source URL is too long, show the source name/domain and keep the visible source footer compact.
- Keep all text within panel bounds. No overlapping labels. No misspelled masthead.
- The final result should feel like a premium AI-cyber situation surface, not a decorative poster.`;
}

function compactBrief(brief: VisualBrief): VisualBrief {
  return {
    ...brief,
    metrics: brief.metrics.slice(0, 6),
    sections: brief.sections.slice(0, 5),
    timeline: brief.timeline.slice(0, 5),
    sources: brief.sources.slice(0, 5),
    themeHints: brief.themeHints.slice(0, 10),
    ...(brief.table
      ? {
          table: {
            ...brief.table,
            headers: brief.table.headers.slice(0, 4),
            rows: brief.table.rows.slice(0, 6).map((row) => row.slice(0, 4)),
          },
        }
      : {}),
  };
}

function sanitizeBriefForSafety(brief: VisualBrief): VisualBrief {
  return {
    ...brief,
    title: softenText(brief.title),
    bluf: softenText(brief.bluf),
    entityKind: brief.entityKind ? softenText(brief.entityKind) : brief.entityKind,
    entityId: brief.entityId ? softenText(brief.entityId) : brief.entityId,
    metrics: brief.metrics.map((metric) => ({
      label: softenText(metric.label),
      value: softenText(metric.value),
      ...(metric.detail ? { detail: softenText(metric.detail) } : {}),
    })),
    sections: brief.sections.map((section) => ({
      label: softenText(section.label),
      body: softenText(section.body),
    })),
    timeline: brief.timeline.map((item) => ({
      label: softenText(item.label),
      value: softenText(item.value),
    })),
    sources: brief.sources.map((source, index) => ({
      ...source,
      name: source.name ? softenText(source.name) : `Source ${index + 1}`,
      url: source.url.startsWith('/') ? '/source/reference' : domainOnly(source.url),
    })),
    table: brief.table
      ? {
          title: softenText(brief.table.title),
          headers: brief.table.headers.map(softenText),
          rows: brief.table.rows.map((row) => row.map(softenText)),
        }
      : undefined,
    themeHints: brief.themeHints.map(softenText).filter(Boolean),
  };
}

function softenText(value: string): string {
  return value
    .replace(/\bGCHQ\/MI6\b/gi, 'UK security sources')
    .replace(/\bGCHQ\b/gi, 'UK security source')
    .replace(/\bMI6\b/gi, 'UK security source')
    .replace(/\bCIA\b|\bNSA\b|\bFSB\b|\bGRU\b/gi, 'security source')
    .replace(/\bKremlin\b/gi, 'Russian government')
    .replace(/\bintelligence\b/gi, 'analysis')
    .replace(/\bthreats?\b/gi, 'risk')
    .replace(/\battack(?:s|ed|ing)?\b/gi, 'incident')
    .replace(/\btarget(?:s|ed|ing)?\b/gi, 'focus area')
    .replace(/\boperational\b/gi, 'situational')
    .replace(/\bclassified\b/gi, 'restricted')
    .replace(/\bsurveillance\b/gi, 'monitoring')
    .replace(/\bmilitary\b/gi, 'security')
    .replace(/\bweapon(?:s)?\b/gi, 'system')
    .replace(/\bwar\b/gi, 'conflict')
    .trim();
}

function domainOnly(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}
