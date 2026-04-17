/**
 * Renders the widget heartbeat — "Last ping from yoursite.com, 3 min
 * ago" — which is the single signal that tells an operator whether
 * their `<script>` tag is actually loading on their site. Shown on the
 * inbox empty state and as a subtle live indicator in the project
 * header once tickets start flowing.
 */
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
        <Dot tone="muted" /> Waiting for the first widget ping — is the{' '}
        <code className="px-1 bg-gray-100 rounded">&lt;script&gt;</code> tag deployed?
      </Shell>
    );
  }

  const ago = relativeTime(new Date(lastPingAt));
  const origin = lastPingOrigin ?? 'unknown origin';
  const fresh = Date.now() - new Date(lastPingAt).getTime() < 5 * 60 * 1000;

  return (
    <Shell variant={variant} tone={fresh ? 'fresh' : 'stale'}>
      <Dot tone={fresh ? 'fresh' : 'stale'} />
      Last ping from <strong className="font-medium">{origin}</strong>, {ago}
    </Shell>
  );
}

function Shell({
  variant,
  tone,
  children,
}: {
  variant: 'inline' | 'block';
  tone: 'fresh' | 'stale' | 'muted';
  children: React.ReactNode;
}) {
  const base =
    variant === 'block'
      ? 'flex items-center gap-2 px-4 py-3 rounded-lg border text-sm'
      : 'inline-flex items-center gap-2 text-xs';
  const bg =
    variant === 'block'
      ? tone === 'fresh'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : tone === 'stale'
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-gray-50 border-gray-200 text-gray-600'
      : 'text-gray-600';
  return <div className={`${base} ${bg}`}>{children}</div>;
}

function Dot({ tone }: { tone: 'fresh' | 'stale' | 'muted' }) {
  const color =
    tone === 'fresh' ? 'bg-emerald-500' : tone === 'stale' ? 'bg-amber-500' : 'bg-gray-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} aria-hidden="true" />;
}

/**
 * Human-friendly relative time. Intentionally simple — we have no
 * i18n surface yet, and the numbers we care about ("3 min ago",
 * "2 h ago") are the ones that change an operator's behavior. For
 * everything older than a day, show the absolute date.
 */
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
