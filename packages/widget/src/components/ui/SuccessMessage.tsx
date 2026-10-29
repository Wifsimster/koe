import { Button } from './Button';

export interface SuccessMessageProps {
  emoji: string;
  message: string;
  onDismiss: () => void;
  onViewMyRequests?: () => void;
  viewMyRequestsLabel?: string;
  dismissLabel?: string;
}

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
