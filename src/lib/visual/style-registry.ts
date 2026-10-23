/**
 * Style-tag registry: maps AEGIS entity kinds to visual register choices.
 *
 * Each style defines:
 *   - backdropPromptTemplate: passed to gpt-image-2 (with text suppression)
 *   - overlayLayout: which React overlay component renders the data
 *   - palette: brand colors used by both the backdrop prompt and overlay
 *
 * These curated families keep the Cocoa AI CRT identity while letting the
 * image model move away from one repeated terminal-dossier composition.
 */

export type StyleTag =
  | 'kev_pressure'
  | 'identity_intrusion'
  | 'supply_chain_map'
  | 'research_gap_card'
  | 'exposure_ledger'
  | 'market_signal_board'
  | 'crt_terminal';

export interface StyleDefinition {
  tag: StyleTag;
  label: string;
  defaultFor: Array<{ entityKind: string }>;
  backdropPromptTemplate: string;
  overlayLayout: 'pressure' | 'identity' | 'map' | 'research' | 'ledger' | 'chart' | 'terminal';
  palette: { primary: string; secondary: string; accent: string };
}

export const STYLE_REGISTRY: Record<StyleTag, StyleDefinition> = {
  kev_pressure: {
    tag: 'kev_pressure',
    label: 'KEV pressure',
    defaultFor: [{ entityKind: 'kev' }, { entityKind: 'cve_critical' }, { entityKind: 'cve' }],
    backdropPromptTemplate:
      'Exploit-pressure backdrop. Abstract patch clock, exposure lanes, ' +
      'severity telemetry, dark command-center field, and critical red warning ' +
      'accents. No text, no letters, no words, no fake UI labels. Palette: ' +
      'matrix green (#00ff41), near-black, critical red.',
    overlayLayout: 'pressure',
    palette: { primary: '#00ff41', secondary: '#0a0a0a', accent: '#ff0040' },
  },
  identity_intrusion: {
    tag: 'identity_intrusion',
    label: 'Identity intrusion',
    defaultFor: [{ entityKind: 'threat_actor' }],
    backdropPromptTemplate:
      'Identity-plane intrusion backdrop. Abstract inbox graph, account nodes, ' +
      'OAuth token trails, login telemetry, and one anonymous silhouette with no ' +
      'identifiable face. No text, no letters, no words. Palette: deep blue-grey, ' +
      'matrix green, amber credential accents.',
    overlayLayout: 'identity',
    palette: { primary: '#00ff41', secondary: '#1a1a2e', accent: '#ffaa00' },
  },
  supply_chain_map: {
    tag: 'supply_chain_map',
    label: 'Supply-chain map',
    defaultFor: [
      { entityKind: 'supply_chain' },
      { entityKind: 'package' },
      { entityKind: 'botnet' },
    ],
    backdropPromptTemplate:
      'Software supply-chain topology backdrop. Package registry lattice, ' +
      'dependency graph, propagation paths, repository nodes, and containment ' +
      'breaks. No text, no letters, no words, no fake logos. Palette: matrix ' +
      'green, near-black, electric blue and amber route accents.',
    overlayLayout: 'map',
    palette: { primary: '#00ff41', secondary: '#07110b', accent: '#4db8ff' },
  },
  research_gap_card: {
    tag: 'research_gap_card',
    label: 'Research gap card',
    defaultFor: [{ entityKind: 'research' }, { entityKind: 'policy' }, { entityKind: 'article' }],
    backdropPromptTemplate:
      'Editorial research-card backdrop. Survey marks, split belief-versus-reality ' +
      'columns, annotated source-paper texture, quiet analytical tension. No text, ' +
      'no letters, no words. Palette: near-black, muted paper grey, matrix green, ' +
      'measured amber.',
    overlayLayout: 'research',
    palette: { primary: '#00ff41', secondary: '#111111', accent: '#d6a84f' },
  },
  exposure_ledger: {
    tag: 'exposure_ledger',
    label: 'Exposure ledger',
    defaultFor: [
      { entityKind: 'breach' },
      { entityKind: 'incident' },
      { entityKind: 'compromised_org' },
    ],
    backdropPromptTemplate:
      'Exposure-ledger backdrop. Dark accounting book meets incident register: ' +
      'affected-party columns, record-count blocks, vendor/customer blast-radius ' +
      'rings, and audit stamps. No text, no letters, no words. Palette: matrix ' +
      'green, near-black, muted red, ledger grey.',
    overlayLayout: 'ledger',
    palette: { primary: '#00ff41', secondary: '#101010', accent: '#ff4444' },
  },
  market_signal_board: {
    tag: 'market_signal_board',
    label: 'Market signal board',
    defaultFor: [{ entityKind: 'forecast' }, { entityKind: 'predictions' }],
    backdropPromptTemplate:
      'Market-signal data board backdrop. Probability bands, compact charts, ' +
      'ticker strips, confidence intervals, and risk dashboard modules with ' +
      'restrained editorial polish. No text, no letters, no words. Palette: ' +
      'near-black, matrix green, off-white, muted red/amber signal marks.',
    overlayLayout: 'chart',
    palette: { primary: '#00ff41', secondary: '#0a0a0a', accent: '#ffaa00' },
  },
  crt_terminal: {
    tag: 'crt_terminal',
    label: 'CRT terminal',
    defaultFor: [],
    backdropPromptTemplate:
      'CRT terminal backdrop. Phosphor-green glow on dark surface, scanlines, ' +
      'monospace 80s-90s mainframe aesthetic. Slight curvature, screen-burn ' +
      'ambience. Composition leaves clear central area for text. No text in ' +
      'image, no letters, no words. Palette: matrix green (#00ff41) on near-' +
      'black (#0a0a0a).',
    overlayLayout: 'terminal',
    palette: { primary: '#00ff41', secondary: '#0a0a0a', accent: '#00ff41' },
  },
};

export const STYLE_TAGS = [
  'kev_pressure',
  'identity_intrusion',
  'supply_chain_map',
  'research_gap_card',
  'exposure_ledger',
  'market_signal_board',
  'crt_terminal',
] as const satisfies readonly StyleTag[];

const STYLE_TAG_SET: ReadonlySet<StyleTag> = new Set<StyleTag>(STYLE_TAGS);

export function isStyleTag(tag: unknown): tag is StyleTag {
  return typeof tag === 'string' && STYLE_TAG_SET.has(tag as StyleTag);
}

export function resolveStyleTag(entityKind: string | undefined, override?: StyleTag): StyleTag {
  if (override !== undefined && isStyleTag(override)) {
    return override;
  }
  if (!entityKind) return 'crt_terminal';
  for (const def of Object.values(STYLE_REGISTRY)) {
    if (def.defaultFor.some((rule) => rule.entityKind === entityKind)) {
      return def.tag;
    }
  }
  return 'crt_terminal';
}
