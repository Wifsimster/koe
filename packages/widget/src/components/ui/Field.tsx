import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

interface BaseProps {
  label: string;
  error?: string;
}

export function TextField({
  label,
  error,
  className,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="koe-block koe-mb-3">
      <span className="koe-block koe-text-xs koe-font-medium koe-text-koe-text-muted koe-mb-1">
        {label}
      </span>
      <input
        {...rest}
        className={clsx(
          // `text-base` is `16px`. Anything smaller triggers iOS Safari's
          // auto-zoom on focus, which ruins the panel layout.
          'koe-w-full koe-px-3 koe-py-2 koe-text-base koe-rounded-md koe-border koe-border-koe-border koe-bg-koe-bg focus:koe-outline-none focus:koe-border-koe-accent',
          error && 'koe-border-red-500',
          className,
        )}
      />
      {error && <span className="koe-block koe-text-xs koe-text-red-500 koe-mt-1">{error}</span>}
    </label>
  );
}

export function TextAreaField({
  label,
  error,
  className,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="koe-block koe-mb-3">
      <span className="koe-block koe-text-xs koe-font-medium koe-text-koe-text-muted koe-mb-1">
        {label}
      </span>
      <textarea
        rows={3}
        {...rest}
        className={clsx(
          // See `TextField`: 16px minimum to avoid iOS auto-zoom.
          'koe-w-full koe-px-3 koe-py-2 koe-text-base koe-rounded-md koe-border koe-border-koe-border koe-bg-koe-bg focus:koe-outline-none focus:koe-border-koe-accent',
          error && 'koe-border-red-500',
          className,
        )}
      />
      {error && <span className="koe-block koe-text-xs koe-text-red-500 koe-mt-1">{error}</span>}
    </label>
  );
}
