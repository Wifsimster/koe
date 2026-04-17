import { useEffect, useId } from 'react';

/**
 * Minimal accessible confirm dialog.
 *
 * - Escape and backdrop click cancel.
 * - Enter does NOT auto-confirm — the destructive button has to be
 *   tabbed to. Keyboard-pounders default to the safer action.
 * - `autoFocus` lands on Cancel for the same reason.
 * - `aria-labelledby` / `aria-describedby` wired via `useId` so
 *   multiple dialogs on the same page (unlikely, but cheap to do
 *   right) don't collide.
 *
 * Mount on demand — the component renders null from the caller when
 * no confirmation is pending.
 */
export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Disables the buttons and swaps the confirm label for a spinner. */
  submitting: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  submitting,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => {
        // Only treat clicks on the backdrop as cancel — clicks on
        // the card itself shouldn't dismiss.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-5">
        <h3 id={titleId} className="text-base font-semibold text-gray-900">
          {title}
        </h3>
        <p id={bodyId} className="mt-2 text-sm text-gray-600">
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            autoFocus
            className="min-h-[36px] px-3 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={submitting}
            className="min-h-[36px] px-3 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
          >
            {submitting ? 'Applying…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
