import { Button } from './Button';

export interface SuccessMessageProps {
  /** Short emoji rendered above the message (e.g. ✓, ✨). */
  emoji: string;
  message: string;
  onDismiss: () => void;
  /**
   * Optional secondary CTA for jumping to the "my requests" screen.
   * Only shown for sessions with a verified identity — the Panel gates
   * this, so callers pass the handler when appropriate.
   */
  onViewMyRequests?: () => void;
  viewMyRequestsLabel?: string;
  dismissLabel?: string;
}

/**
 * Post-submission acknowledgement rendered by the bug and feature
 * forms. Both forms used to inline this; the only thing that differed
 * was the emoji, so factor it into one component.
 */
export function SuccessMessage({
  emoji,
  message,
  onDismiss,
  onViewMyRequests,
  viewMyRequestsLabel,
  dismissLabel = 'Submit another',
}: SuccessMessageProps) {
  return (
    <div className="koe-text-center koe-py-6">
      <div className="koe-mb-3 koe-text-2xl">{emoji}</div>
      <p className="koe-text-sm koe-mb-4">{message}</p>
      <div className="koe-flex koe-flex-col koe-items-center koe-gap-2">
        <Button variant="ghost" type="button" onClick={onDismiss}>
          {dismissLabel}
        </Button>
        {onViewMyRequests && viewMyRequestsLabel && (
          <Button variant="outline" type="button" onClick={onViewMyRequests}>
            {viewMyRequestsLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
