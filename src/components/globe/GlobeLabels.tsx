'use client';

import { Html } from '@react-three/drei';
import { useCallback, useMemo } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { Hotspot } from '@/lib/types';
import { latLonToVector3, severityToHex } from '@/lib/utils/geo';
import { prefillAgent } from '@/lib/utils/panel-actions';

export function GlobeLabels() {
  const hotspots = useGlobeStore((s) => s.hotspots);
  const selectHotspot = useGlobeStore((s) => s.selectHotspot);
  const selectMarker = useGlobeStore((s) => s.selectMarker);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const labelData = useMemo(() => {
    return hotspots.map((hotspot) => ({
      id: hotspot.id,
      name: hotspot.name,
      severity: hotspot.severity,
      category: hotspot.category,
      lat: hotspot.lat,
      lon: hotspot.lon,
      position: latLonToVector3(hotspot.lat, hotspot.lon, 1.03),
      color: severityToHex(hotspot.severity),
      hotspot,
    }));
  }, [hotspots]);

  const handleLabelClick = useCallback(
    (hotspot: Hotspot) => {
      selectHotspot(hotspot);
      selectMarker(`hotspot-${hotspot.id}`);
      flyTo(hotspot.lat, hotspot.lon);
      const prompt = `Brief me on the current situation at ${hotspot.name}. What are the key developments and risks?`;
      prefillAgent(prompt, {
        sourcePanel: 'globe',
        dataType: 'hotspot',
        trendData: {
          name: hotspot.name,
          severity: hotspot.severity,
          category: hotspot.category,
          sourceUrl: hotspot.url,
        },
      });
    },
    [selectHotspot, selectMarker, flyTo],
  );

  if (labelData.length === 0) return null;

  return (
    <group>
      {labelData.map((label) => (
        <Html
          key={label.id}
          position={label.position}
          center
          occlude
          distanceFactor={4}
          style={{ pointerEvents: 'auto' }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLabelClick(label.hotspot);
            }}
            style={{
              background: 'rgba(10, 10, 10, 0.85)',
              border: '1px solid rgba(100, 100, 100, 0.3)',
              borderRadius: '4px',
              padding: '3px 7px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
              backdropFilter: 'blur(4px)',
              cursor: 'pointer',
              transition: 'border-color 0.2s, box-shadow 0.2s',
              pointerEvents: 'auto',
              font: 'inherit',
              color: 'inherit',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = label.color;
              (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 8px ${label.color}40`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(100, 100, 100, 0.3)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
            }}
          >
            {/* Severity dot */}
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: label.color,
                boxShadow: `0 0 4px ${label.color}`,
                flexShrink: 0,
              }}
            />
            {/* Label text */}
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: '#d4d4d8',
                fontWeight: 500,
              }}
            >
              {label.name}
            </span>
          </button>
        </Html>
      ))}
    </group>
  );
}
