import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyRequestRow, TicketStatus } from '@koe/shared';
import { useKoe } from '../context/KoeContext';
import { KoeApiError } from '../api/client';
import { Button } from './ui/Button';

/**
 * "My requests" screen. Lists tickets where `reporterId` matches the
 * current identity. Gated on a real (non-anonymous) `config.user.id`
 * in `IntentPicker` so anonymous visitors never land here and see a
 * bag of tickets from other anonymous visitors sharing the same
 * fallback id.
 */
export function MyRequestsList() {
  const { api, config, locale } = useKoe();
  const copy = locale.myRequests ?? DEFAULT_MY_REQUESTS;
  const userId = config.user?.id;

  const [items, setItems] = useState<MyRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!userId) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    api
      .listMyRequests(userId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof KoeApiError && err.code === 'network_error') {
          setError(locale.errors.network);
        } else {
          setError(err instanceof Error ? err.message : locale.errors.generic);
        }
        setLoading(false);
      });
  }, [api, userId, locale.errors.network, locale.errors.generic]);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  if (loading && !items) {
    return <p className="koe-text-xs koe-text-koe-text-muted koe-py-4">{copy.loading}</p>;
  }

  if (error && !items) {
    return (
      <div className="koe-py-4 koe-flex koe-flex-col koe-items-start koe-gap-3">
        <p className="koe-text-xs koe-text-red-500 koe-m-0" role="alert">
          {copy.error}
        </p>
        <Button variant="outline" type="button" onClick={load}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="koe-text-xs koe-text-koe-text-muted koe-py-4 koe-text-center">{copy.empty}</p>
    );
  }

  return (
    <ul className="koe-list-none koe-m-0 koe-p-0">
      {items.map((item) => (
        <RequestRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

interface RequestRowProps {
  item: MyRequestRow;
}

function RequestRow({ item }: RequestRowProps) {
  const { locale, api } = useKoe();
  const copy = locale.myRequests ?? DEFAULT_MY_REQUESTS;
  const statusLabel = copy.status[item.status] ?? item.status;
  const kindIcon = item.kind === 'bug' ? '🐞' : '💡';

  return (
    <li className="koe-flex koe-gap-3 koe-py-3 koe-border-b koe-border-koe-border last:koe-border-b-0">
      <span className="koe-text-lg koe-leading-none koe-mt-0.5" aria-hidden="true">
        {kindIcon}
      </span>
      <div className="koe-min-w-0 koe-flex-1">
        <p className="koe-text-sm koe-font-medium koe-text-koe-text koe-m-0 koe-truncate">
          {item.title}
        </p>
        <div className="koe-flex koe-items-center koe-gap-2 koe-mt-1 koe-flex-wrap">
          <StatusBadge status={item.status} label={statusLabel} />
          {item.kind === 'feature' && item.voteCount > 0 && (
            <span className="koe-text-[11px] koe-text-koe-text-muted">▲ {item.voteCount}</span>
          )}
          {item.isPublicRoadmap && (
            <a
              className="koe-text-[11px] koe-text-koe-accent koe-underline"
              href={api.roadmapUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.viewOnRoadmap}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status, label }: { status: TicketStatus; label: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className="koe-inline-flex koe-items-center koe-px-2 koe-py-0.5 koe-text-[10px] koe-font-medium koe-rounded-full"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  );
}

const STATUS_TONE: Record<TicketStatus, { bg: string; fg: string }> = {
  open: { bg: '#eef2ff', fg: '#3730a3' },
  in_progress: { bg: '#fef3c7', fg: '#92400e' },
  planned: { bg: '#dbeafe', fg: '#1e40af' },
  resolved: { bg: '#dcfce7', fg: '#166534' },
  closed: { bg: '#f3f4f6', fg: '#4b5563' },
  wont_fix: { bg: '#fee2e2', fg: '#991b1b' },
};

const DEFAULT_MY_REQUESTS = {
  title: 'My requests',
  loading: 'Loading your requests…',
  empty: "You haven't submitted anything yet.",
  error: "Couldn't load your requests.",
  retry: 'Try again',
  viewOnRoadmap: 'View on roadmap',
  status: {
    open: 'Open',
    in_progress: 'In progress',
    planned: 'Planned',
    resolved: 'Shipped',
    closed: 'Closed',
    wont_fix: "Won't fix",
  },
};
