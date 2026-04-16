import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        // `min-h-[44px]` enforces WCAG 2.5.5 / Apple HIG minimum target
        // so mobile users don't fat-finger the submit or close button.
        'koe-inline-flex koe-items-center koe-justify-center koe-min-h-[44px] koe-px-4 koe-py-2 koe-rounded-md koe-text-sm koe-font-medium koe-transition-colors disabled:koe-opacity-60 disabled:koe-cursor-not-allowed',
        variant === 'primary' &&
          'koe-bg-koe-accent koe-text-white hover:koe-bg-koe-accent-hover',
        variant === 'ghost' &&
          'koe-text-koe-text-muted hover:koe-text-koe-text hover:koe-bg-koe-bg-muted',
        className,
      )}
    >
      {loading ? '…' : children}
    </button>
  );
}
