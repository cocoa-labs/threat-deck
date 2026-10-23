'use client';

import { cn } from '@/lib/utils/cn';

interface CRTFrameProps {
  className?: string;
  children: React.ReactNode;
}

export function CRTFrame({ className, children }: CRTFrameProps) {
  return (
    <div
      className={cn('relative flex flex-col overflow-hidden crt-no-motion', className)}
      style={{
        border:
          'var(--crt-border-width) solid rgba(var(--crt-glow-rgb), var(--crt-glow-intensity))',
        background: 'var(--crt-panel-bg)',
      }}
    >
      {/* Corner brackets */}
      <Corner position="top-left" />
      <Corner position="top-right" />
      <Corner position="bottom-left" />
      <Corner position="bottom-right" />

      {/* Glow overlay */}
      <div
        className="absolute inset-0 z-[0] pointer-events-none"
        style={{
          boxShadow:
            '0 0 var(--crt-glow-spread) rgba(var(--crt-glow-rgb), var(--crt-pulse-max)), inset 0 0 6px rgba(var(--crt-glow-rgb), 0.08)',
          animation: 'crt-glow-pulse 4s ease-in-out infinite',
        }}
      />

      {/* Scanline overlay */}
      <div className="crt-scanlines absolute inset-0 z-[1]" />

      {/* Content */}
      <div className="relative z-[2] flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

function Corner({
  position,
}: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}) {
  const isTop = position.startsWith('top');
  const isLeft = position.endsWith('left');

  return (
    <div
      className="absolute z-[3]"
      style={{
        width: 'var(--crt-corner-size)',
        height: 'var(--crt-corner-size)',
        ...(isTop ? { top: 0 } : { bottom: 0 }),
        ...(isLeft ? { left: 0 } : { right: 0 }),
        borderColor: 'rgba(var(--crt-glow-rgb), 0.6)',
        borderStyle: 'solid',
        borderWidth: 0,
        ...(isTop && { borderTopWidth: 'var(--crt-corner-thickness)' }),
        ...(!isTop && { borderBottomWidth: 'var(--crt-corner-thickness)' }),
        ...(isLeft && { borderLeftWidth: 'var(--crt-corner-thickness)' }),
        ...(!isLeft && { borderRightWidth: 'var(--crt-corner-thickness)' }),
      }}
    />
  );
}
