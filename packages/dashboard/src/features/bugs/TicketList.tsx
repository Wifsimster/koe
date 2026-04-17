import type { AdminTicket } from '../../api/client';
import { Badge, priorityTone, statusTone } from '../../components/ui/Badge';
import { relativeTime, cx } from '../../lib/format';

/**
 * Left pane of the triage view — scrollable ticket list, virtualization
 * not needed at the page sizes we page through. Rows are `<button>` for
 * keyboard accessibility and focus rings; selection style follows the
 * `selected` prop.
 */
export function TicketList({
  tickets,
  selectedId,
  onSelect,
  loading,
  onLoadMore,
  hasMore,
}: {
  tickets: AdminTicket[];
  selectedId: string | null;
  onSelect: (t: AdminTicket) => void;
  loading: boolean;
  onLoadMore: () => void;
  hasMore: boolean;
}) {
  if (!loading && tickets.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        No tickets match this filter.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {tickets.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t)}
            className={cx(
              'w-full text-left px-4 py-3 hover:bg-gray-50 transition',
              selectedId === t.id && 'bg-indigo-50 hover:bg-indigo-50',
            )}
          >
            <div className="flex items-center gap-2">
              <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
              <span className="text-sm font-medium text-gray-900 truncate flex-1">
                {t.title}
              </span>
              <span className="text-xs text-gray-400 shrink-0">
                {relativeTime(t.createdAt)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
              <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
              <span className="truncate">
                {t.reporterName ?? t.reporterEmail ?? t.reporterId}
                {t.reporterVerified ? ' ✓' : ''}
              </span>
            </div>
          </button>
        </li>
      ))}
      {hasMore ? (
        <li className="p-3 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="text-sm text-indigo-600 hover:underline disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
