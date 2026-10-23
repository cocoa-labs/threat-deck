'use client';

import { LivestreamSurface } from '@/components/panels/LivestreamPanel';

export function HeroLiveTab({ active }: { active: boolean }) {
  return (
    <div className="absolute inset-0 flex min-w-0 bg-[#050505]">
      <LivestreamSurface
        active={active}
        autoplayMuted
        instanceId="hero-live"
        mode="hero"
        title="LIVE"
      />
    </div>
  );
}
