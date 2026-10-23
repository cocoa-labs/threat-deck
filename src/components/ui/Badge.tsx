import { cn } from '@/lib/utils/cn';

type BadgeVariant = 'green' | 'blue' | 'amber' | 'red' | 'cyan' | 'purple' | 'muted';

interface BadgeProps {
  children: React.ReactNode;
  variant: BadgeVariant;
  size?: 'xs' | 'sm';
  icon?: React.ReactNode;
  pill?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  green:
    'text-[var(--badge-green)] bg-[color-mix(in_srgb,var(--badge-green)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-green)_40%,transparent)]',
  blue: 'text-[var(--badge-blue)] bg-[color-mix(in_srgb,var(--badge-blue)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-blue)_40%,transparent)]',
  amber:
    'text-[var(--badge-amber)] bg-[color-mix(in_srgb,var(--badge-amber)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-amber)_40%,transparent)]',
  red: 'text-[var(--badge-red)] bg-[color-mix(in_srgb,var(--badge-red)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-red)_40%,transparent)]',
  cyan: 'text-[var(--badge-cyan)] bg-[color-mix(in_srgb,var(--badge-cyan)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-cyan)_40%,transparent)]',
  purple:
    'text-[var(--badge-purple)] bg-[color-mix(in_srgb,var(--badge-purple)_18%,transparent)] border-[color-mix(in_srgb,var(--badge-purple)_40%,transparent)]',
  muted: 'text-[var(--text-secondary)] bg-[var(--bg-hover)] border-[var(--border-default)]',
};

export function Badge({
  children,
  variant,
  size = 'xs',
  icon,
  pill = true,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border font-mono font-semibold uppercase tracking-wider',
        size === 'xs' ? 'text-[7px] px-1.5 py-0.5' : 'text-[8px] px-2 py-0.5',
        pill ? 'rounded-full' : 'rounded',
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
