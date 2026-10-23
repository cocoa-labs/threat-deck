'use client';

import { useCallback } from 'react';
import { Popup } from 'react-map-gl/mapbox';
import type { ViewportFeature } from '@/lib/mapbox/viewport-features';
import { prefillAgent } from '@/lib/utils/panel-actions';

interface MapContextMenuProps {
  lat: number;
  lon: number;
  features: ViewportFeature[];
  onDismiss: () => void;
}

export function MapContextMenu({ lat, lon, features, onDismiss }: MapContextMenuProps) {
  const googleMapsUrl = `https://www.google.com/maps/@${lat},${lon},17z`;

  const handleAnalyze = useCallback(() => {
    const featureNames = features.slice(0, 5).map((f) => f.name);
    const featureContext = featureNames.length > 0 ? ` near ${featureNames.join(', ')}` : '';

    prefillAgent(
      `Search for information about this area at ${lat.toFixed(4)}, ${lon.toFixed(4)}${featureContext}. What characterizes this area — notable places, neighborhood context, and any relevant developments? Include Google Maps links and web sources.`,
      {
        sourcePanel: 'map',
        dataType: 'map_location',
        trendData: {
          lat,
          lon,
          googleMapsUrl,
          nearbyFeatures: features.slice(0, 5),
        },
      },
    );
    onDismiss();
  }, [lat, lon, features, googleMapsUrl, onDismiss]);

  return (
    <Popup
      longitude={lon}
      latitude={lat}
      anchor="bottom"
      offset={8}
      closeButton={false}
      closeOnClick
      onClose={onDismiss}
      className="klammer-popup"
    >
      <div className="font-mono text-xs">
        {features.length > 0 ? (
          <div className="border-b" style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.12)' }}>
            {features.slice(0, 5).map((f) => (
              <a
                key={`${f.name}-${f.lat}-${f.lon}`}
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.name} ${f.lat.toFixed(6)},${f.lon.toFixed(6)}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] transition-colors hover:bg-[rgba(0,170,255,0.08)]"
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="shrink-0"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <div>
                  <div>{f.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{f.type}</div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <a
            href={`https://www.google.com/maps/@${lat},${lon},17z`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[var(--text-primary)] transition-colors hover:bg-[rgba(0,170,255,0.08)]"
            style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.12)' }}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>View in Maps</span>
          </a>
        )}
        <button
          type="button"
          onClick={handleAnalyze}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-primary)] transition-colors hover:bg-[rgba(0,170,255,0.08)]"
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-[var(--crt-glow)]"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>Analyze this location</span>
        </button>
      </div>
    </Popup>
  );
}
