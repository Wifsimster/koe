import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import type { TicketKind, TicketStatus } from '@koe/shared';
import { useAuth } from '../auth/AuthContext';
import type { AdminProject, AdminTicket, AssigneeFilter } from '../api/client';
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
  const [kind, setKind] = useState<TicketKind | 'all'>('all');
  const [status, setStatus] = useState<TicketStatus | 'all'>('open');
  // `all` is client-side only (omits the query param); `me` and
  // `unassigned` are the two shortcuts the server resolves.
  const [assignee, setAssignee] = useState<AssigneeFilter | 'all'>('all');

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

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

      {loading && tickets === null ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : tickets && tickets.length === 0 ? (
        <EmptyTickets project={project} />
      ) : (
        <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
          {(tickets ?? []).map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
        </ul>
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

function TicketRow({ ticket }: { ticket: AdminTicket }) {
  return (
    <li>
      <Link
        to="/tickets/$id"
        params={{ id: ticket.id }}
        className="block p-4 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:bg-gray-50"
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
