import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import type { TicketPriority, TicketStatus } from '@koe/shared';
import { useAuth } from '../auth/AuthContext';
import type { AdminTicket, TicketEvent } from '../api/client';

/**
 * Ticket detail view with inline status + priority edits.
 *
 * Role-gated: owners and members see editable dropdowns, viewers see
 * read-only chips. The backend enforces the same rule — the UI
 * hiding the controls is convenience, not security.
 *
 * Optimistic update shape: flip the local value immediately, call the
 * API, revert + surface an error if the call fails. A plain `<select>`
 * is the widget here — it's keyboard-accessible by default, works
 * thumb-first on mobile, and doesn't need a custom dropdown library.
 *
 * Notes / comments and assignment are deliberately out of scope; they
 * earn their way in one at a time as the flow demands them (see the
 * meeting analysis).
 */
export function TicketDetailPage() {
  const { id } = useParams({ from: '/_authenticated/tickets/$id' });
  const { state, api } = useAuth();
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

  // Membership role for the active project — decides whether the
  // edit controls render at all.
  const role =
    state.status === 'authenticated'
      ? state.me.memberships.find((m) => m.projectKey === activeKey)?.role ?? 'viewer'
      : 'viewer';
  const canWrite = role === 'owner' || role === 'member';

  // There's no dedicated "get ticket" endpoint — we find it in the
  // project's list. Acceptable while the lists are small; when they
  // grow, add `/v1/admin/tickets/:id` and keep this page identical.
  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    api
      .listTickets(activeKey, { limit: 200 })
      .then((rows) => {
        if (!alive) return;
        const found = rows.find((t) => t.id === id);
        if (!found) {
          setError('Ticket not found in this project.');
          return;
        }
        setTicket(found);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load ticket');
      });
    return () => {
      alive = false;
    };
  }, [activeKey, api, id]);

  const loadEvents = useCallback(async () => {
    if (!activeKey) return;
    try {
      const rows = await api.listTicketEvents(activeKey, id);
      setEvents(rows);
    } catch (err) {
      // Audit trail is a nice-to-have on this page. A failure here
      // should not fail the page — the ticket itself is still useful.
      console.warn('[koe/dashboard] listTicketEvents failed', err);
    }
  }, [activeKey, api, id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const applyPatch = async (patch: { status?: TicketStatus; priority?: TicketPriority }) => {
    if (!activeKey || !ticket) return;
    const prev = ticket;
    setMutError(null);
    setMutating(true);
    // Optimistic swap.
    setTicket({ ...ticket, ...patch });
    try {
      const next = await api.updateTicket(activeKey, ticket.id, patch);
      setTicket(next);
      // Pull the new event(s) so the Activity section reflects what
      // just happened. The server only emits events for values that
      // actually changed, so the re-read is harmless when the patch
      // was a no-op.
      void loadEvents();
    } catch (err) {
      // Roll back and surface the reason.
      setTicket(prev);
      setMutError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setMutating(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="text-sm text-gray-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackLink />

      <header className="bg-white border border-gray-200 rounded-lg p-4 md:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-2xl leading-7">
            {ticket.kind === 'bug' ? '🐞' : '💡'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-gray-900 break-words">{ticket.title}</h2>
            <div className="mt-1 text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{new Date(ticket.createdAt).toLocaleString()}</span>
              {ticket.kind === 'feature' && <span>{ticket.voteCount} votes</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canWrite ? (
                <StatusSelect
                  value={ticket.status}
                  disabled={mutating}
                  onChange={(status) => void applyPatch({ status })}
                />
              ) : (
                <ReadonlyChip label={`status: ${ticket.status.replace('_', ' ')}`} />
              )}
              {canWrite ? (
                <PrioritySelect
                  value={ticket.priority}
                  disabled={mutating}
                  onChange={(priority) => void applyPatch({ priority })}
                />
              ) : (
                <ReadonlyChip label={`priority: ${ticket.priority}`} />
              )}
            </div>
            {mutError && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {mutError}
              </p>
            )}
          </div>
        </div>
      </header>

      <Section title="Description">
        <p className="whitespace-pre-wrap text-sm text-gray-800">{ticket.description}</p>
      </Section>

      {ticket.kind === 'bug' && (ticket.stepsToReproduce || ticket.expectedBehavior || ticket.actualBehavior) && (
        <Section title="Reproduction">
          {ticket.stepsToReproduce && (
            <Field label="Steps">{ticket.stepsToReproduce}</Field>
          )}
          {ticket.expectedBehavior && (
            <Field label="Expected">{ticket.expectedBehavior}</Field>
          )}
          {ticket.actualBehavior && <Field label="Actual">{ticket.actualBehavior}</Field>}
        </Section>
      )}

      <Section title="Reporter">
        <dl className="text-sm text-gray-700 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-gray-500">id</dt>
          <dd className="font-mono text-xs break-all">{ticket.reporterId}</dd>
          {ticket.reporterName && (
            <>
              <dt className="text-gray-500">name</dt>
              <dd>{ticket.reporterName}</dd>
            </>
          )}
          {ticket.reporterEmail && (
            <>
              <dt className="text-gray-500">email</dt>
              <dd>{ticket.reporterEmail}</dd>
            </>
          )}
          <dt className="text-gray-500">verified</dt>
          <dd>{ticket.reporterVerified ? 'yes (HMAC)' : 'no'}</dd>
        </dl>
        {!ticket.reporterVerified && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
            This reporter was not verified. If you reply via the email they provided, that address
            is self-asserted — not confirmed by the host app.
          </p>
        )}
      </Section>

      {ticket.metadata && (
        <Section title="Browser context">
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto">
{JSON.stringify(ticket.metadata, null, 2)}
          </pre>
        </Section>
      )}

      {ticket.screenshotUrl && (
        <Section title="Screenshot">
          <a
            href={ticket.screenshotUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-indigo-700 hover:underline"
          >
            Open screenshot
          </a>
        </Section>
      )}

      <Section title="Activity">
        <ActivityList events={events} />
      </Section>
    </div>
  );
}

function ActivityList({ events }: { events: TicketEvent[] | null }) {
  if (events === null) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No changes yet. Future status and priority edits will show up here.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {events.map((ev) => (
        <li key={ev.id} className="text-sm text-gray-700 border-l-2 border-gray-200 pl-3">
          <div>
            <span className="font-medium">{ev.actorEmail ?? 'deleted user'}</span>{' '}
            {describeEvent(ev)}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(ev.createdAt).toLocaleString()}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Turn an event row into a readable sentence. The payload shape is
 * per-kind; we narrow each one here and fall back to a generic line
 * when we hit a kind we don't render yet (assignment, comments).
 */
function describeEvent(ev: TicketEvent): string {
  if (ev.kind === 'status_changed') {
    const from = readString(ev.payload.from);
    const to = readString(ev.payload.to);
    return `changed status from ${from} to ${to}`;
  }
  if (ev.kind === 'priority_changed') {
    const from = readString(ev.payload.from);
    const to = readString(ev.payload.to);
    return `changed priority from ${from} to ${to}`;
  }
  if (ev.kind === 'assigned') {
    return 'updated the assignment';
  }
  if (ev.kind === 'commented') {
    return 'left a comment';
  }
  return `performed ${ev.kind}`;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : '?';
}

const STATUS_OPTIONS: Array<{ value: TicketStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'planned', label: 'Planned' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'wont_fix', label: "Won't fix" },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function StatusSelect({
  value,
  disabled,
  onChange,
}: {
  value: TicketStatus;
  disabled: boolean;
  onChange: (v: TicketStatus) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide">status</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TicketStatus)}
        disabled={disabled}
        className="text-sm px-2 py-1 rounded-md border border-gray-300 bg-white min-h-[36px] disabled:opacity-60"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrioritySelect({
  value,
  disabled,
  onChange,
}: {
  value: TicketPriority;
  disabled: boolean;
  onChange: (v: TicketPriority) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide">priority</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TicketPriority)}
        disabled={disabled}
        className="text-sm px-2 py-1 rounded-md border border-gray-300 bg-white min-h-[36px] disabled:opacity-60"
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadonlyChip({ label }: { label: string }) {
  return (
    <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-1">
      {label}
    </span>
  );
}

function BackLink() {
  return (
    <Link to="/" className="text-sm text-indigo-700 hover:underline">
      ← Back to inbox
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 md:p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-gray-800">{children}</div>
    </div>
  );
}
