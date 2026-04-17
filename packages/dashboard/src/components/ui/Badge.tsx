import type { ReactNode } from 'react';
import { cx } from '../../lib/format';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function priorityTone(priority: string): Tone {
  switch (priority) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    default:
      return 'neutral';
  }
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'open':
      return 'info';
    case 'in_progress':
    case 'planned':
      return 'warning';
    case 'resolved':
      return 'success';
    case 'closed':
    case 'wont_fix':
      return 'neutral';
    default:
      return 'neutral';
  }
}
