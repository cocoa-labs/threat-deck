'use client';

import { Stars } from '@react-three/drei';
import { useMemo } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import { getSunPosition, latLonToVector3 } from '@/lib/utils/geo';
import { GlobeArcs } from './GlobeArcs';
import { GlobeAtmosphere } from './GlobeAtmosphere';
import { GlobeConflictZones } from './GlobeConflictZones';
import { GlobeControls } from './GlobeControls';
import { GlobeDayNight } from './GlobeDayNight';
import { GlobeHeatmap } from './GlobeHeatmap';
import { GlobeInfrastructure } from './GlobeInfrastructure';
import { GlobeLabels } from './GlobeLabels';
import { GlobeMarkerCard } from './GlobeMarkerCard';
import { GlobeMarkers } from './GlobeMarkers';
import { GlobeMesh } from './GlobeMesh';
import { GlobeMilitaryBases } from './GlobeMilitaryBases';
import { GlobeParticles } from './GlobeParticles';
import { GlobeThreatRings } from './GlobeThreatRings';

export function GlobeScene() {
  const activeLayers = useGlobeStore((s) => s.activeLayers);

  const sunPosition = useMemo(() => {
    const { lat, lon } = getSunPosition();
    return latLonToVector3(lat, lon, 5);
  }, []);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <directionalLight position={sunPosition} intensity={1.2} color="#ffeedd" />

      {/* Stars background */}
      <Stars radius={100} depth={50} count={4000} factor={4} saturation={0} fade speed={0.5} />

      {/* Core globe */}
      <GlobeMesh />
      <GlobeAtmosphere />

      {/* Ambient particles - data flow effect */}
      <GlobeParticles />

      {/* Layers */}
      {activeLayers.has('markers') && <GlobeMarkers />}
      {activeLayers.has('markers') && <GlobeLabels />}
      {activeLayers.has('threatRings') && <GlobeThreatRings />}
      {activeLayers.has('arcs') && <GlobeArcs />}
      {activeLayers.has('dayNight') && <GlobeDayNight />}
      {activeLayers.has('heatmap') && <GlobeHeatmap />}
      {activeLayers.has('conflictZones') && <GlobeConflictZones />}
      {activeLayers.has('militaryBases') && <GlobeMilitaryBases />}
      {activeLayers.has('infrastructure') && <GlobeInfrastructure />}

      {/* Hover card (renders rich content for cyber markers, basic for others) */}
      <GlobeMarkerCard />

      {/* Camera controls */}
      <GlobeControls />
    </>
  );
}
