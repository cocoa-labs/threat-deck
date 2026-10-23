'use client';

import { PredictionsSurface } from '@/components/panels/PredictionsPanel';

export function HeroForecastTab() {
  return (
    <div className="absolute inset-0 bg-[#050505]">
      <PredictionsSurface variant="hero" />
    </div>
  );
}
