import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { usePatchTicket, useTickets } from '../api/queries';
import type { AdminTicket, TicketListQuery } from '../api/client';
import { TicketFilters } from '../features/bugs/TicketFilters';
import { TicketList } from '../features/bugs/TicketList';
import { TicketDetail } from '../features/bugs/TicketDetail';

/**
 * Split-pane triage for bugs. List on the left, detail on the right.
 * Filters live in local state; paging is handled by accumulating the
 * returned items as the cursor advances. URL-state migration is a
 * deliberate follow-up — keeps the filter param schema flexible while
 * the endpoints are still settling.
 */
export function BugsPage() {
  const { client, projectKey } = useApp();

  const [filter, setFilter] = useState<TicketListQuery>({ kind: 'bug', limit: 50 });
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<AdminTicket[]>([]);

  const tickets = useTickets(client, projectKey, { ...filter, cursor });

  // Append newly-arrived page to the accumulated list. De-dupe by id
  // so an optimistic update followed by a refetch doesn't double the
  // row.
  useEffect(() => {
    if (!tickets.data) return;
    if (cursor === undefined) {
      setAccumulated(tickets.data.items);
    } else {
      setAccumulated((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const merged = [...prev];
        for (const t of tickets.data!.items) if (!seen.has(t.id)) merged.push(t);
        return merged;
      });
    }
  }, [tickets.data, cursor]);

  // Reset pagination whenever the filter changes.
  function handleFilterChange(next: TicketListQuery) {
    setCursor(undefined);
    setAccumulated([]);
    setFilter({ ...next, kind: next.kind ?? 'bug', limit: 50 });
  }

  function handleLoadMore() {
    const next = tickets.data?.pageInfo.nextCursor;
    if (next) setCursor(next);
  }

  // Keep the accumulated list reactive to mutations: every time the
  // current page's first-page query invalidates we want the edits to
  // show. We re-read from the query cache via the current page data.
  const items = useMemo(() => {
    // If we're on the first page (no cursor), prefer the freshest
    // response from the query — it reflects optimistic edits.
    if (cursor === undefined && tickets.data) {
      // Keep any later-page items the user already loaded.
      const firstIds = new Set(tickets.data.items.map((t) => t.id));
      const tail = accumulated.filter((t) => !firstIds.has(t.id));
      return [...tickets.data.items, ...tail];
    }
    return accumulated;
  }, [accumulated, tickets.data, cursor]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && !items.some((t) => t.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    } else if (!selectedId && items.length > 0) {
      setSelectedId(items[0]!.id);
    }
  }, [items, selectedId]);

  const selected = items.find((t) => t.id === selectedId) ?? null;

  const patch = usePatchTicket(client, projectKey);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-8">
      <header className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-semibold">Bugs</h2>
          <span className="text-xs text-gray-500">
            {tickets.isFetching ? 'Refreshing…' : `${items.length} showing`}
          </span>
        </div>
        <TicketFilters value={filter} onChange={handleFilterChange} />
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,380px)_1fr]">
        <aside className="border-r border-gray-200 bg-white overflow-auto">
          <TicketList
            tickets={items}
            selectedId={selectedId}
            onSelect={(t) => setSelectedId(t.id)}
            loading={tickets.isFetching}
            onLoadMore={handleLoadMore}
            hasMore={Boolean(tickets.data?.pageInfo.hasMore)}
          />
        </aside>

        <section className="overflow-auto bg-white">
          {selected ? (
            <TicketDetail
              ticket={selected}
              disabled={patch.isPending}
              onPatch={(p) => patch.mutate({ id: selected.id, patch: p })}
            />
          ) : (
            <div className="p-8 text-sm text-gray-500">
              {tickets.isLoading ? 'Loading…' : 'Select a ticket to see details.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
