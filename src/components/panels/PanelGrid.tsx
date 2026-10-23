'use client';

import { PanelSection } from '@/components/panels/PanelSection';
import { PanelShell } from '@/components/panels/PanelShell';
import { PANEL_COMPONENTS, PANEL_SECTIONS } from '@/components/panels/panel-registry';
import { PANEL_CONFIGS, usePanelsStore } from '@/lib/store/panels-store';
import type { PanelId } from '@/lib/types';

/* ─── Placeholder for panels not yet implemented ─── */

function PanelPlaceholder({ id, title, span }: { id: PanelId; title: string; span: 1 | 2 }) {
  return (
    <PanelShell id={id} title={title} span={span}>
      <div className="flex h-full min-h-[120px] items-center justify-center">
        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          {id}
        </span>
      </div>
    </PanelShell>
  );
}

/* ─── PanelGrid (Legacy — used as fallback for non-U-shape layouts) ─── */

export function PanelGrid() {
  const visiblePanels = usePanelsStore((s) => s.visiblePanels);

  // Check if any panels are visible at all
  const hasAnyVisible = PANEL_SECTIONS.some((section) =>
    section.panelIds.some((id) => visiblePanels.has(id)),
  );

  if (!hasAnyVisible) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-mono text-[var(--text-dim)]">No panels visible</span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            Toggle panels from the sidebar
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Gradient fade from transparent to bg-primary */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-8"
        style={{
          background: 'linear-gradient(to bottom, var(--bg-primary), transparent)',
          zIndex: 1,
        }}
      />

      <div className="pt-2 px-px">
        {PANEL_SECTIONS.map((section) => {
          // Get visible panels for this section
          const sectionPanels = section.panelIds
            .filter((id) => visiblePanels.has(id))
            .map((id) => PANEL_CONFIGS.find((c) => c.id === id))
            .filter(Boolean);

          if (sectionPanels.length === 0) return null;

          return (
            <PanelSection key={section.label} label={section.label}>
              {sectionPanels.map((panel) => {
                const Component = PANEL_COMPONENTS[panel!.id];
                const span = panel!.span <= 2 ? (panel!.span as 1 | 2) : 2;

                if (Component) {
                  return <Component key={panel!.id} />;
                }

                return (
                  <PanelPlaceholder
                    key={panel!.id}
                    id={panel!.id}
                    title={panel!.title}
                    span={span}
                  />
                );
              })}
            </PanelSection>
          );
        })}
      </div>
    </div>
  );
}
