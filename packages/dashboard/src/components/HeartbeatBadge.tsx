import { cn } from '../lib/utils';

type Tone = 'fresh' | 'stale' | 'muted';

export function HeartbeatBadge({
  lastPingAt,
  lastPingOrigin,
  variant = 'inline',
}: {
  lastPingAt: string | null;
  lastPingOrigin: string | null;
  variant?: 'inline' | 'block';
}) {
  if (!lastPingAt) {
    return (
      <Shell variant={variant} tone="muted">
        <Dot tone="muted" />
        <span>
          Waiting for the first widget ping — is the{' '}
          <code className="rounded-none border border-border bg-muted px-1">
            &lt;script&gt;
          </code>{' '}
          tag deployed?
        </span>
      </Shell>
    );
  }

  const ago = relativeTime(new Date(lastPingAt));
  const origin = lastPingOrigin ?? 'unknown origin';
  const fresh = Date.now() - new Date(lastPingAt).getTime() < 5 * 60 * 1000;
  const tone: Tone = fresh ? 'fresh' : 'stale';

  return (
    <Shell variant={variant} tone={tone}>
      <Dot tone={tone} />
      <span>
        Last ping from <span className="font-medium text-foreground">{origin}</span>,{' '}
        <span className="font-mono text-[11px]">{ago}</span>
      </span>
    </Shell>
  );
}

function Shell({
  variant,
  tone,
  children,
}: {
  variant: 'inline' | 'block';
  tone: Tone;
  children: React.ReactNode;
}) {
  if (variant === 'inline') {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-l-2 bg-card px-4 py-3 text-sm text-muted-foreground',
        tone === 'fresh' && 'border-l-primary',
        tone === 'stale' && 'border-l-destructive/70',
        tone === 'muted' && 'border-l-border',
      )}
    >
      {children}
    </div>
  );
}

function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 rounded-full',
        tone === 'fresh' && 'animate-pulse bg-primary',
        tone === 'stale' && 'bg-destructive/70',
        tone === 'muted' && 'bg-muted-foreground/40',
      )}
    />
  );
}

function relativeTime(past: Date): string {
  const diffMs = Date.now() - past.getTime();
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return past.toLocaleDateString();
}
