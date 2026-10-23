/**
 * Top-level React component for visual overlay generation (Phase 14 Tier A).
 *
 * Renders the structured overlay (masthead, BLUF, data tiles, source line)
 * for compositing onto an AI backdrop. Satori turns this JSX into an SVG,
 * @vercel/og turns the SVG into a PNG, sharp composites it onto the backdrop.
 *
 * IMPORTANT: This component uses inline styles only (Satori does not support
 * CSS classes or external stylesheets). Use flexbox layout — Satori's only
 * supported display mode.
 */

import type { CSSProperties, JSX } from 'react';
import { STYLE_REGISTRY, type StyleTag } from '../style-registry';

export interface InfographicProps {
  styleTag: StyleTag;
  bluf: string;
  entityKind?: string;
  entityId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  dataTiles?: Array<{ label: string; value: string }>;
  sourceUrl?: string;
  generatedAt: string; // ISO 8601 timestamp
}

const WIDTH = 1200;
const HEIGHT = 2400;

const SEVERITY_COLOR: Record<NonNullable<InfographicProps['severity']>, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
  low: '#00ff41',
};

export function InfographicTemplate(props: InfographicProps): JSX.Element {
  const style = STYLE_REGISTRY[props.styleTag];
  const isLightBg = false;
  const textColor = isLightBg ? '#0a0a0a' : '#e8e8e8';
  const mutedColor = isLightBg ? '#555555' : '#888888';

  const container: CSSProperties = {
    width: WIDTH,
    height: HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    padding: '80px 60px',
    color: textColor,
    fontFamily: 'GeistMono',
    background: 'transparent',
  };

  return (
    <div style={container}>
      {/* MASTHEAD — Cocoa AI wordmark + sigil */}
      <div
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 60 }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            background: style.palette.primary,
            borderRadius: 6,
            display: 'flex',
            marginRight: 16,
          }}
        />
        <div
          style={{
            fontFamily: 'InstrumentSerif',
            fontStyle: 'italic',
            fontSize: 64,
            color: style.palette.primary,
            display: 'flex',
          }}
        >
          Cocoa AI
        </div>
        <div style={{ flex: 1, display: 'flex' }} />
        <div style={{ fontSize: 24, color: mutedColor, display: 'flex' }}>Threat Deck</div>
      </div>

      {/* SEVERITY BAND */}
      {props.severity && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            background: SEVERITY_COLOR[props.severity],
            color: '#0a0a0a',
            padding: '12px 24px',
            fontSize: 28,
            fontFamily: 'VT323',
            marginBottom: 40,
            alignSelf: 'flex-start',
          }}
        >
          {props.severity.toUpperCase()}
          {props.entityId ? ` · ${props.entityId}` : ''}
        </div>
      )}

      {/* BLUF — the lead observation in the brand voice */}
      <div
        style={{
          display: 'flex',
          fontSize: 56,
          lineHeight: 1.25,
          fontFamily: 'GeistMono',
          color: textColor,
          marginBottom: 80,
        }}
      >
        {props.bluf}
      </div>

      {/* DATA TILES */}
      {props.dataTiles && props.dataTiles.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginBottom: 80,
          }}
        >
          {props.dataTiles.map((tile, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 28px',
                background: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                border: `2px solid ${style.palette.primary}`,
                minWidth: 200,
                marginRight: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{ display: 'flex', fontSize: 22, color: mutedColor, fontFamily: 'VT323' }}
              >
                {tile.label}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 44,
                  color: textColor,
                  fontFamily: 'GeistMono',
                  marginTop: 4,
                }}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1, display: 'flex' }} />

      {/* FOOTER — source + timestamp */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 24,
          borderTop: `2px solid ${style.palette.primary}`,
        }}
      >
        {props.sourceUrl && (
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              color: style.palette.primary,
              fontFamily: 'GeistMono',
              marginBottom: 8,
            }}
          >
            {truncateUrl(props.sourceUrl, 80)}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 20, color: mutedColor, fontFamily: 'VT323' }}>
          {`generated ${new Date(props.generatedAt).toISOString().slice(0, 19).replace('T', ' ')} UTC`}
        </div>
      </div>
    </div>
  );
}

function truncateUrl(url: string, max: number): string {
  return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
}
