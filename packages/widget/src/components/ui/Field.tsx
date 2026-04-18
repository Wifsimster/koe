import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

interface BaseProps {
  label: string;
  error?: string;
}

const inputClasses =
  // `text-base` is 16px — anything smaller triggers iOS Safari's auto-zoom
  // on focus, which ruins the panel layout.
  'koe-w-full koe-px-3 koe-py-2 koe-text-base koe-border koe-border-koe-border koe-bg-koe-bg focus:koe-outline-none focus:koe-border-koe-text focus:koe-ring-1 focus:koe-ring-koe-text';

export function TextField({
  label,
  error,
  className,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="koe-block koe-mb-4">
      <span className="koe-label koe-mb-1.5">{label}</span>
      <input
        {...rest}
        className={clsx(inputClasses, error && 'koe-border-red-500', className)}
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
    <label className="koe-block koe-mb-4">
      <span className="koe-label koe-mb-1.5">{label}</span>
      <textarea
        rows={3}
        {...rest}
        className={clsx(inputClasses, error && 'koe-border-red-500', className)}
      />
      {error && <span className="koe-block koe-text-xs koe-text-red-500 koe-mt-1">{error}</span>}
    </label>
  );
}
