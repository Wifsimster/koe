import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { InboxSearch } from '../router';
import clsx from 'clsx';
import type { TicketKind, TicketPriority, TicketStatus } from '@koe/shared';
import { useAuth } from '../auth/AuthContext';
import type {
  AdminProject,
  AdminTicket,
  AssigneeFilter,
  ProjectMember,
} from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HeartbeatBadge } from '../components/HeartbeatBadge';

/**
 * The triage inbox. Job-to-be-done: scan incoming bug reports and
 * feature requests, tap one to read, maybe route elsewhere. This is
 * the dashboard's *home* (not a stats overview) because that's what
 * project owners actually open the app to do.
 *
 * Mobile-first shape:
 *   - All viewports get the same list. Cards, not rows — works on a
 *     phone and scales up without a redesign.
 *   - Kind + status filters live at the top as chip buttons so a
 *     thumb can switch focus ("just the bugs") without a dropdown.
 *   - Empty state prioritizes the *heartbeat* before suggesting the
 *     user wait — "is the script even deployed?" is the question the
 *     operator is really asking when the list is empty.
 *
 * Data loading is kept deliberately simple — no cache, no optimistic
 * mutations, no infinite scroll. 50 rows is plenty for today and
 * complexity earns its way in when a real customer hits the wall.
 */
export function InboxPage() {
  const { state, api } = useAuth();
  const [project, setProject] = useState<AdminProject | null>(null);
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters live in the URL, not component state — so refresh
  // preserves the view, links are shareable, and the back button
  // actually undoes a filter change. Values come back already
  // narrowed by the route's `validateSearch`, so no further parsing.
  //
  // The `as InboxSearch` casts are unfortunate: TanStack Router's
  // deep generic inference gives up when a sibling route has its
  // own search shape (the `/login` route uses `redirectTo`). The
  // runtime shape is guaranteed by `validateSearch` itself.
  const { kind, status, assignee } = useSearch({
    from: '/_authenticated/',
  }) as unknown as InboxSearch;
  const navigate = useNavigate();
  const setKind = useCallback(
    (v: TicketKind | 'all') =>
      void navigate({
        to: '/',
        search: (prev) => ({ ...(prev as unknown as InboxSearch), kind: v }),
      }),
    [navigate],
  );
  const setStatus = useCallback(
    (v: TicketStatus | 'all') =>
      void navigate({
        to: '/',
        search: (prev) => ({ ...(prev as unknown as InboxSearch), status: v }),
      }),
    [navigate],
  );
  const setAssignee = useCallback(
    (v: AssigneeFilter | 'all') =>
      void navigate({
        to: '/',
        search: (prev) => ({ ...(prev as unknown as InboxSearch), assignee: v }),
      }),
    [navigate],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  /**
   * Pending bulk action awaiting confirmation. We only gate
   * destructive statuses (`closed`, `wont_fix`) behind a dialog —
   * other changes are trivially reversible from the detail page.
   */
  const [pendingBulk, setPendingBulk] = useState<
    { status: TicketStatus; count: number } | null
  >(null);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

  // Role gate for the bulk actions toolbar — viewers see checkboxes
  // too but the apply button is blocked at render time (and the
  // server would refuse anyway via `requireProjectWriter`).
  const role =
    state.status === 'authenticated'
      ? state.me.memberships.find((m) => m.projectKey === activeKey)?.role ?? 'viewer'
      : 'viewer';
  const canWrite = role === 'owner' || role === 'member';

  // Resolve the active project object — needed for the heartbeat
  // display, and `/projects` returns it already so we pay one call.
  useEffect(() => {
    if (!activeKey) {
      setProject(null);
      return;
    }
    let alive = true;
    api
      .listProjects()
      .then((rows) => {
        if (!alive) return;
        setProject(rows.find((p) => p.key === activeKey) ?? null);
      })
      .catch((err) => {
        if (!alive) return;
        console.warn('[koe/dashboard] listProjects failed', err);
      });
    return () => {
      alive = false;
    };
  }, [activeKey, api]);

  const loadTickets = useCallback(async () => {
    if (!activeKey) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api.listTickets(activeKey, {
        kind: kind === 'all' ? undefined : kind,
        status: status === 'all' ? undefined : status,
        assignee: assignee === 'all' ? undefined : assignee,
      });
      setTickets(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [activeKey, api, kind, status, assignee]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // Members load lazily when a writer is on the page — viewers never
  // see the bulk assign picker, so spare them the round-trip.
  useEffect(() => {
    if (!activeKey || !canWrite) return;
    let alive = true;
    api
      .listProjectMembers(activeKey)
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch((err) => {
        console.warn('[koe/dashboard] listProjectMembers failed', err);
      });
    return () => {
      alive = false;
    };
  }, [activeKey, api, canWrite]);

  // Clear the selection whenever the filter set changes or the
  // ticket list reloads — otherwise an operator can select a row,
  // switch filters, and silently lose track of what's about to apply.
  useEffect(() => {
    setSelected(new Set());
    setBulkError(null);
  }, [activeKey, kind, status, assignee]);

  const applyBulk = useCallback(
    async (patch: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignedToUserId?: string | null;
    }) => {
      if (!activeKey || selected.size === 0) return;
      setBulkError(null);
      setBulkSubmitting(true);
      try {
        await api.bulkUpdateTickets(activeKey, Array.from(selected), patch);
        // Re-fetch rather than optimistic: the status filter may
        // cause rows to leave the current page (e.g. "Open →
        // Resolved" hides them), which is simpler to handle via a
        // fresh server query than to replay client-side.
        setSelected(new Set());
        await loadTickets();
      } catch (err) {
        setBulkError(err instanceof Error ? err.message : 'Bulk update failed');
      } finally {
        setBulkSubmitting(false);
      }
    },
    [activeKey, api, selected, loadTickets],
  );

  /**
   * Intercept bulk status changes that are hard to undo mentally:
   * `closed` and `wont_fix` both say "stop working on this". A
   * fat-fingered bulk close of 20 tickets is a real untangle; the
   * dialog is the guardrail.
   *
   * Any other status goes through immediately — the audit trail
   * already makes a status flip reversible from the detail page,
   * and adding a dialog on every change would train ops to dismiss
   * it without reading.
   */
  const requestBulkStatus = useCallback(
    (next: TicketStatus) => {
      if (next === 'closed' || next === 'wont_fix') {
        setPendingBulk({ status: next, count: selected.size });
        return;
      }
      void applyBulk({ status: next });
    },
    [applyBulk, selected.size],
  );

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (ids: string[]) => setSelected(new Set(ids));
  const clearSelection = () => setSelected(new Set());

  const counts = useMemo(() => {
    const map = { all: tickets?.length ?? 0, bug: 0, feature: 0 };
    for (const t of tickets ?? []) map[t.kind] += 1;
    return map;
  }, [tickets]);

  if (!activeKey) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
        You don't have access to any project yet. An owner has to invite you before you can triage
        tickets.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {project && (
        <HeartbeatBadge
          lastPingAt={project.lastPingAt}
          lastPingOrigin={project.lastPingOrigin}
          variant="block"
        />
      )}

      <FilterChips
        kind={kind}
        onKindChange={setKind}
        status={status}
        onStatusChange={setStatus}
        assignee={assignee}
        onAssigneeChange={setAssignee}
        counts={counts}
      />

      {error && (
        <div
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3"
        >
          {error}
        </div>
      )}

      {canWrite && selected.size > 0 && (
        <BulkToolbar
          count={selected.size}
          members={members}
          submitting={bulkSubmitting}
          error={bulkError}
          onStatus={requestBulkStatus}
          onPriority={(p) => void applyBulk({ priority: p })}
          onAssignee={(a) => void applyBulk({ assignedToUserId: a })}
          onClear={clearSelection}
        />
      )}

      {pendingBulk && (
        <ConfirmDialog
          title={confirmTitleFor(pendingBulk.status, pendingBulk.count)}
          body={confirmBodyFor(pendingBulk.status)}
          confirmLabel={confirmLabelFor(pendingBulk.status)}
          submitting={bulkSubmitting}
          onConfirm={async () => {
            const status = pendingBulk.status;
            setPendingBulk(null);
            await applyBulk({ status });
          }}
          onCancel={() => setPendingBulk(null)}
        />
      )}

      {loading && tickets === null ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : tickets && tickets.length === 0 ? (
        <EmptyTickets project={project} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {canWrite && tickets && tickets.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-200 text-xs text-gray-500 flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.size === tickets.length && tickets.length > 0}
                // `indeterminate` is a runtime DOM property, not a
                // React prop — set it via a ref callback so the
                // "some rows selected" tri-state shows up correctly.
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selected.size > 0 && selected.size < tickets.length;
                  }
                }}
                onChange={(e) => {
                  if (e.target.checked) selectAll(tickets.map((t) => t.id));
                  else clearSelection();
                }}
                aria-label="Select all tickets on this page"
                className="h-4 w-4"
              />
              <span>
                {selected.size > 0
                  ? `${selected.size} of ${tickets.length} selected`
                  : 'Select all'}
              </span>
            </div>
          )}
          <ul className="divide-y divide-gray-200">
            {(tickets ?? []).map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                selectable={canWrite}
                selected={selected.has(t.id)}
                onToggleSelect={() => toggleSelected(t.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FilterChips({
  kind,
  onKindChange,
  status,
  onStatusChange,
  assignee,
  onAssigneeChange,
  counts,
}: {
  kind: TicketKind | 'all';
  onKindChange: (v: TicketKind | 'all') => void;
  status: TicketStatus | 'all';
  onStatusChange: (v: TicketStatus | 'all') => void;
  assignee: AssigneeFilter | 'all';
  onAssigneeChange: (v: AssigneeFilter | 'all') => void;
  counts: { all: number; bug: number; feature: number };
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip active={kind === 'all'} onClick={() => onKindChange('all')}>
        All · {counts.all}
      </Chip>
      <Chip active={kind === 'bug'} onClick={() => onKindChange('bug')}>
        Bugs · {counts.bug}
      </Chip>
      <Chip active={kind === 'feature'} onClick={() => onKindChange('feature')}>
        Ideas · {counts.feature}
      </Chip>
      <span className="mx-1 w-px bg-gray-200 hidden sm:inline" aria-hidden="true" />
      <Chip
        active={assignee === 'me'}
        onClick={() => onAssigneeChange(assignee === 'me' ? 'all' : 'me')}
      >
        Mine
      </Chip>
      <Chip
        active={assignee === 'unassigned'}
        onClick={() =>
          onAssigneeChange(assignee === 'unassigned' ? 'all' : 'unassigned')
        }
      >
        Unassigned
      </Chip>
      <span className="mx-1 w-px bg-gray-200 hidden sm:inline" aria-hidden="true" />
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as typeof status)}
        className="text-sm px-2 py-1 rounded-full border border-gray-300 bg-white min-h-[36px]"
      >
        <option value="all">Any status</option>
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="planned">Planned</option>
        <option value="resolved">Resolved</option>
        <option value="closed">Closed</option>
        <option value="wont_fix">Won't fix</option>
      </select>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'text-sm px-3 rounded-full border min-h-[36px] transition-colors',
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400',
      )}
    >
      {children}
    </button>
  );
}

function TicketRow({
  ticket,
  selectable,
  selected,
  onToggleSelect,
}: {
  ticket: AdminTicket;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <li className="flex items-start">
      {selectable && (
        <label
          className="flex items-center px-4 pt-4 min-h-[44px] cursor-pointer"
          // Keep the checkbox tap separate from the card navigation
          // so a thumb-tap on the row still opens the detail.
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ticket "${ticket.title}"`}
            className="h-4 w-4"
          />
        </label>
      )}
      <Link
        to="/tickets/$id"
        params={{ id: ticket.id }}
        className="flex-1 block p-4 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:bg-gray-50"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-lg leading-6">
            {ticket.kind === 'bug' ? '🐞' : '💡'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-gray-900 truncate">{ticket.title}</h3>
              <StatusPill status={ticket.status} />
              {!ticket.reporterVerified && <UnverifiedPill />}
            </div>
            <p className="mt-1 text-sm text-gray-600 line-clamp-2">{ticket.description}</p>
            <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-3">
              <span>{new Date(ticket.createdAt).toLocaleString()}</span>
              {ticket.reporterEmail && <span>{ticket.reporterEmail}</span>}
              {ticket.kind === 'feature' && <span>{ticket.voteCount} votes</span>}
              <AssigneeChip ticket={ticket} />
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * Bulk actions toolbar. Appears above the list when ≥1 ticket is
 * selected. Three dropdowns — status, priority, assignee — each
 * submits the patch on change. No "apply" button: the choice IS the
 * commit. Keeps the UX scannable (one decision per dropdown) and
 * matches the inline edit pattern on the ticket detail page.
 *
 * The assignee dropdown uses an empty-string sentinel for "Unassign"
 * because native select can't carry null. The translation to `null`
 * lives at the onChange.
 */
function BulkToolbar({
  count,
  members,
  submitting,
  error,
  onStatus,
  onPriority,
  onAssignee,
  onClear,
}: {
  count: number;
  members: ProjectMember[] | null;
  submitting: boolean;
  error: string | null;
  onStatus: (v: TicketStatus) => void;
  onPriority: (v: TicketPriority) => void;
  onAssignee: (v: string | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium text-indigo-900">
        {count} selected
      </span>
      <BulkSelect
        disabled={submitting}
        placeholder="Mark as…"
        onChange={(v) => onStatus(v as TicketStatus)}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'planned', label: 'Planned' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
          { value: 'wont_fix', label: "Won't fix" },
        ]}
      />
      <BulkSelect
        disabled={submitting}
        placeholder="Priority…"
        onChange={(v) => onPriority(v as TicketPriority)}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ]}
      />
      <BulkSelect
        disabled={submitting || members === null}
        placeholder="Assign to…"
        onChange={(v) => onAssignee(v === '__unassign__' ? null : v)}
        options={[
          { value: '__unassign__', label: 'Unassign' },
          ...(members ?? []).map((m) => ({
            value: m.userId,
            label: m.displayName ?? m.email,
          })),
        ]}
      />
      <button
        type="button"
        onClick={onClear}
        disabled={submitting}
        className="text-xs text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
      >
        Clear
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700 w-full">
          {error}
        </p>
      )}
    </div>
  );
}

function BulkSelect({
  disabled,
  placeholder,
  onChange,
  options,
}: {
  disabled: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      disabled={disabled}
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') return;
        onChange(v);
        // Reset so the placeholder shows again — the dropdown is a
        // fire-and-forget control, not a persistent filter.
        e.target.value = '';
      }}
      className="text-sm px-2 rounded-md border border-gray-300 bg-white min-h-[36px] disabled:opacity-60 max-w-[180px]"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function StatusPill({ status }: { status: TicketStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className={clsx(
        'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border',
        tone,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function statusTone(s: TicketStatus): string {
  switch (s) {
    case 'open':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'in_progress':
    case 'planned':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'resolved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'closed':
    case 'wont_fix':
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function UnverifiedPill() {
  return (
    <span
      title="Reporter was not verified via HMAC when this ticket was submitted"
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200"
    >
      unverified
    </span>
  );
}

/**
 * One-liner assignment indicator for the card. Prefers displayName
 * over email so a quick scan of the inbox reads like "assigned to
 * Alice" rather than a mailing list. `null` assignee renders as a
 * muted "unassigned" tag so tickets-in-need-of-an-owner stand out.
 */
function AssigneeChip({ ticket }: { ticket: AdminTicket }) {
  if (ticket.assignedToUserId === null) {
    return <span className="text-amber-700">unassigned</span>;
  }
  const label = ticket.assignedToDisplayName ?? ticket.assignedToEmail ?? 'someone';
  return <span>assigned to {label}</span>;
}

function EmptyTickets({ project }: { project: AdminProject | null }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600 text-center">
      <p className="mb-2">No tickets match these filters.</p>
      {project && !project.lastPingAt && (
        <p className="text-xs text-gray-500">
          The widget hasn't pinged this project yet. Drop the{' '}
          <code className="px-1 bg-gray-100 rounded">&lt;script&gt;</code> tag into your app and
          reload — you'll see a heartbeat here within a minute.
        </p>
      )}
    </div>
  );
}

function confirmTitleFor(status: TicketStatus, count: number): string {
  const plural = count === 1 ? 'ticket' : 'tickets';
  if (status === 'closed') return `Close ${count} ${plural}?`;
  return `Mark ${count} ${plural} as won't fix?`;
}

function confirmBodyFor(status: TicketStatus): string {
  if (status === 'closed') {
    return "Closed tickets drop out of the triage inbox by default. You can still re-open them from the detail page, and the change is visible in each ticket's Activity log.";
  }
  return "Won't-fix tells reporters the team has decided not to take this on. The change shows up in each ticket's Activity log and can be reverted from the detail page.";
}

function confirmLabelFor(status: TicketStatus): string {
  if (status === 'closed') return 'Close tickets';
  return "Mark won't fix";
}

