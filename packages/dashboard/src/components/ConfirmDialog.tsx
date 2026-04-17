import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Disables buttons and swaps the confirm label for a spinner. */
  submitting: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Destructive-action confirmation. Escape / backdrop / cancel are
 * safe; Enter does not auto-confirm because AlertDialog lands focus
 * on Cancel.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  submitting,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading text-xl tracking-tight">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            className={cn(buttonVariants({ variant: 'destructive' }))}
          >
            {submitting ? 'Applying…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
