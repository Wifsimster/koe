import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { usePatchTicket, useTickets } from '../api/queries';
import type { TicketListQuery } from '../api/client';
import type { TicketStatus } from '@koe/shared';
import { Badge, priorityTone, statusTone } from '../components/ui/Badge';
import { relativeTime } from '../lib/format';
import { TicketFilters } from '../features/bugs/TicketFilters';

const STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'planned',
  'resolved',
  'closed',
  'wont_fix',
];

/**
 * Feature requests grouped by status. No split-pane here — for
 * roadmap work the operator mostly wants to see the whole backlog at
 * once and move items between columns. Vote counts are sorted
 * descending inside each column; it's what we want for the "top of
 * mind" view.
 */
export function FeaturesPage() {
  const { client, projectKey } = useApp();
  const [filter, setFilter] = useState<TicketListQuery>({ kind: 'feature', limit: 100 });
  const tickets = useTickets(client, projectKey, filter);
  const patch = usePatchTicket(client, projectKey);

  const grouped = useMemo(() => {
    const by: Record<TicketStatus, typeof tickets.data extends undefined ? never : NonNullable<typeof tickets.data>['items']> = {
      open: [],
      in_progress: [],
      planned: [],
      resolved: [],
      closed: [],
      wont_fix: [],
    };
    for (const t of tickets.data?.items ?? []) {
      by[t.status as TicketStatus].push(t);
    }
    for (const s of STATUSES) {
      by[s].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
    }
    return by;
  }, [tickets.data]);

  const visibleStatuses = filter.status ? [filter.status] : STATUSES;

  return (
    <div>
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Feature requests</h2>
          <p className="text-sm text-gray-500">
            Sorted by vote count. Status changes here flow back to the public roadmap.
          </p>
        </div>
        <span className="text-xs text-gray-500">
          {tickets.isFetching ? 'Refreshing…' : `${tickets.data?.items.length ?? 0} total`}
        </span>
      </header>

      <div className="mb-4">
        <TicketFilters value={filter} onChange={setFilter} />
      </div>

      {tickets.isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleStatuses.map((status) => (
            <section key={status} className="bg-white border border-gray-200 rounded-lg">
              <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <Badge tone={statusTone(status)}>{status.replace('_', ' ')}</Badge>
                <span className="text-xs text-gray-500">{grouped[status].length}</span>
              </header>
              <ul className="divide-y divide-gray-100 max-h-[28rem] overflow-auto">
                {grouped[status].length === 0 ? (
                  <li className="p-4 text-xs text-gray-400 italic">Nothing here.</li>
                ) : (
                  grouped[status].map((t) => (
                    <li key={t.id} className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-indigo-50 text-indigo-700 text-xs font-semibold">
                          {t.voteCount ?? 0}
                        </span>
                        <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                          {t.title}
                        </span>
                        <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{t.description}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">
                          {relativeTime(t.createdAt)}
                        </span>
                        <select
                          value={t.status}
                          disabled={patch.isPending}
                          onChange={(e) =>
                            patch.mutate({
                              id: t.id,
                              patch: { status: e.target.value as TicketStatus },
                            })
                          }
                          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
