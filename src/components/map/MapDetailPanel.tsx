'use client';

import { ExternalLink } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo } from 'react';
import { CyberMarkerDetails } from '@/components/cyber/CyberMarkerDetails';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useAgentStream } from '@/lib/hooks/use-agent-stream';
import { useMapStore } from '@/lib/store/map-store';
import type { IntelligenceCategory, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { getMarkerSourceUrl, isCyberMarker } from '@/lib/utils/cyber-markers';
import { prefillAgent } from '@/lib/utils/panel-actions';

const SEVERITY_BADGE: Record<Severity, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  low: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  info: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30' },
};

const CATEGORY_LABELS: Record<IntelligenceCategory, string> = {
  conflict: 'Conflict',
  economic: 'Economic',
  technology: 'Technology',
  policy: 'Policy',
  proliferation: 'Proliferation',
  instability: 'Instability',
  strategic: 'Strategic',
  market: 'Market',
  alternative: 'Alternative',
  // Cyber categories
  cve_critical: 'CVE — Critical',
  cve_high: 'CVE — High',
  cve_medium: 'CVE — Medium',
  ai_incident: 'AI Incident',
  data_breach: 'Data Breach',
  ransomware: 'Ransomware',
  apt_activity: 'APT Activity',
  zero_day: 'Zero-Day',
  ai_safety: 'AI Safety',
  model_release: 'Model Release',
};

export function MapDetailPanel() {
  const selectedHotspot = useMapStore((s) => s.selectedHotspot);
  const selectedMarkerId = useMapStore((s) => s.selectedMarkerId);
  const markers = useMapStore((s) => s.markers);
  const selectHotspot = useMapStore((s) => s.selectHotspot);
  const selectMarker = useMapStore((s) => s.selectMarker);
  const { invoke } = useAgentStream();

  const selectedCyberMarker = useMemo(() => {
    if (!selectedMarkerId) return null;
    const marker = markers.find((m) => m.id === selectedMarkerId);
    return isCyberMarker(marker) ? marker : null;
  }, [selectedMarkerId, markers]);

  const handleClose = () => {
    selectHotspot(null);
    selectMarker(null);
  };

  const handleAnalyze = useCallback(() => {
    if (!selectedHotspot) return;
    const prompt = `Analyze the current situation at ${selectedHotspot.name} (${selectedHotspot.lat.toFixed(2)}N, ${selectedHotspot.lon.toFixed(2)}E). Category: ${selectedHotspot.category}. Severity: ${selectedHotspot.severity}. Context: ${selectedHotspot.description}. Provide a brief intelligence assessment covering key risks, recent developments, and potential market implications.`;
    invoke(prompt);
  }, [selectedHotspot, invoke]);

  const handleAnalyzeCyber = useCallback(() => {
    if (!selectedCyberMarker) return;
    const sourceUrl = getMarkerSourceUrl(selectedCyberMarker);
    prefillAgent(`Analyze "${selectedCyberMarker.label}".`, {
      sourcePanel: 'map',
      dataType: selectedCyberMarker.cyberCategory,
      trendData: {
        label: selectedCyberMarker.label,
        severity: selectedCyberMarker.severity,
        category: selectedCyberMarker.category,
        cyberCategory: selectedCyberMarker.cyberCategory,
        cveId: selectedCyberMarker.cveId,
        threatActorId: selectedCyberMarker.threatActorId,
        breachId: selectedCyberMarker.breachId,
        iocValue: selectedCyberMarker.iocValue,
        cvssScore: selectedCyberMarker.cvssScore,
        epssScore: selectedCyberMarker.epssScore,
        kevStatus: selectedCyberMarker.kevStatus,
        sourceUrl,
      },
      timestamp: selectedCyberMarker.timestamp ?? selectedCyberMarker.lastActiveAt,
    });
  }, [selectedCyberMarker]);

  return (
    <AnimatePresence>
      {selectedCyberMarker ? (
        <motion.div
          key={selectedCyberMarker.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="absolute right-4 top-4 z-20 rounded-xl border border-zinc-700/50 bg-zinc-900/95 shadow-2xl backdrop-blur-md"
        >
          <CyberMarkerDetails
            marker={selectedCyberMarker}
            variant="panel"
            onClose={handleClose}
            onAnalyze={handleAnalyzeCyber}
            analyzeLabel={AGENT_IDENTITY.analyzeLabel}
          />
        </motion.div>
      ) : selectedHotspot ? (
        <motion.div
          key={selectedHotspot.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-zinc-700/50 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100 leading-snug">
              {selectedHotspot.name}
            </h3>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Close detail panel"
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Badges */}
          <div className="mt-3 flex items-center gap-2">
            {(() => {
              const badge = SEVERITY_BADGE[selectedHotspot.severity] ?? SEVERITY_BADGE.info;
              return (
                <span
                  className={cn(
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    badge.bg,
                    badge.text,
                    badge.border,
                  )}
                >
                  {selectedHotspot.severity}
                </span>
              );
            })()}
            <span className="inline-flex items-center rounded border border-zinc-600/30 bg-zinc-800/50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
              {CATEGORY_LABELS[selectedHotspot.category] ?? selectedHotspot.category}
            </span>
          </div>

          {/* Description */}
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            {selectedHotspot.description}
          </p>

          {/* Coordinates */}
          <div className="mt-3 flex gap-3 text-[10px] text-zinc-600">
            <span>{selectedHotspot.lat.toFixed(2)}N</span>
            <span>{selectedHotspot.lon.toFixed(2)}E</span>
          </div>

          {/* Source link */}
          {selectedHotspot.url && (
            <a
              href={selectedHotspot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1 text-[10px] text-[var(--color-info)] hover:underline"
            >
              <ExternalLink size={10} />
              source reference
            </a>
          )}

          {/* Action */}
          <button
            type="button"
            onClick={handleAnalyze}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {AGENT_IDENTITY.analyzeLabel}
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
