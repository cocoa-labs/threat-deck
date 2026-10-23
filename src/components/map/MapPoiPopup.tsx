'use client';

import { useCallback } from 'react';
import { Popup } from 'react-map-gl/mapbox';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { prefillAgent } from '@/lib/utils/panel-actions';

interface MapPoiPopupProps {
  name: string;
  type: string;
  lat: number;
  lon: number;
  onDismiss: () => void;
}

export function MapPoiPopup({ name, type, lat, lon, onDismiss }: MapPoiPopupProps) {
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat.toFixed(6)},${lon.toFixed(6)}`)}`;

  const handleAnalyze = useCallback(() => {
    prefillAgent(
      `Search for current information about ${name} (${type}) at ${lat.toFixed(4)}, ${lon.toFixed(4)}. What is this place, what is it known for, and what characterizes this area? Include the Google Maps link and any web sources you find.`,
      {
        sourcePanel: 'map',
        dataType: 'map_poi',
        trendData: {
          name,
          type,
          lat,
          lon,
          googleMapsUrl,
        },
      },
    );
    onDismiss();
  }, [name, type, lat, lon, googleMapsUrl, onDismiss]);

  return (
    <Popup
      longitude={lon}
      latitude={lat}
      anchor="bottom"
      offset={12}
      closeButton={false}
      closeOnClick={false}
      onClose={onDismiss}
      className="klammer-popup"
    >
      <div className="font-mono text-xs">
        <div
          className="border-b px-3 py-2"
          style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.12)' }}
        >
          <div className="font-bold text-[var(--text-primary)]">{name}</div>
          <div className="text-[10px] text-[var(--text-muted)]">{type}</div>
        </div>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat.toFixed(6)},${lon.toFixed(6)}`)}`}
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
          <span>View Details</span>
        </a>
        <button
          type="button"
          onClick={handleAnalyze}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--crt-glow)] transition-colors hover:bg-[rgba(0,170,255,0.08)]"
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
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>{AGENT_IDENTITY.analyzeLabel}</span>
        </button>
      </div>
    </Popup>
  );
}
