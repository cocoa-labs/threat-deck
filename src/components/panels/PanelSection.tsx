'use client';

interface PanelSectionProps {
  label: string;
  children: React.ReactNode;
}

export function PanelSection({ label, children }: PanelSectionProps) {
  return (
    <div className="mb-1">
      {/* Section header */}
      <div className="px-px pb-1 pt-3">
        <span className="text-[8px] font-mono font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
          {label}
        </span>
      </div>

      {/* Panel grid within section */}
      <div
        className="grid auto-rows-min gap-px"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        }}
      >
        {children}
      </div>
    </div>
  );
}
