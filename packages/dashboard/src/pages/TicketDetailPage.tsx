import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, Bug, Lightbulb, ShieldAlert } from 'lucide-react';
import type { TicketPriority, TicketStatus } from '@koe/shared';
import { useAuth } from '../auth/AuthContext';
import type { AdminTicket, TicketEvent, TicketPatch } from '../api/client';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';

export function TicketDetailPage() {
  const { id } = useParams({ from: '/_authenticated/tickets/$id' });
  const { state, api } = useAuth();
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    api
      .listTickets(activeKey, { limit: 200 })
      .then((page) => {
        if (!alive) return;
        const found = page.items.find((t) => t.id === id);
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
      console.warn('[koe/dashboard] listTicketEvents failed', err);
    }
  }, [activeKey, api, id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const revertEvent = async (eventId: string): Promise<void> => {
    if (!activeKey) return;
    try {
      const next = await api.revertTicketEvent(activeKey, id, eventId);
      setTicket(next);
      void loadEvents();
    } catch (err) {
      setMutError(err instanceof Error ? err.message : 'Revert failed');
    }
  };

  const applyPatch = async (patch: TicketPatch) => {
    if (!activeKey || !ticket) return;
    const prev = ticket;
    setMutError(null);
    setMutating(true);
    // Optimistic update. `notes` normalises empty string to null so the
    // local ticket shape matches what the server returns.
    setTicket({
      ...ticket,
      ...patch,
      ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
    });
    try {
      const next = await api.updateTicket(activeKey, ticket.id, patch);
      setTicket(next);
      // Notes-only patches don't emit an audit event, so skip the refetch.
      if (patch.status !== undefined || patch.priority !== undefined) {
        void loadEvents();
      }
    } catch (err) {
      setTicket(prev);
      setMutError(err instanceof Error ? err.message : 'Update failed');
      throw err;
    } finally {
      setMutating(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <p role="alert" className="border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-6">
        <BackLink />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const Icon = ticket.kind === 'bug' ? Bug : Lightbulb;

  return (
    <div className="space-y-10">
      <BackLink />

      <header className="space-y-4">
        <div className="flex items-center gap-3 text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{ticket.kind === 'bug' ? 'Bug report' : 'Idea'}</span>
          <span className="font-mono normal-case tracking-normal text-muted-foreground/60">
            {ticket.id.slice(0, 8)}
          </span>
        </div>
        <h1 className="font-heading text-[clamp(2rem,4.5vw,3.75rem)] leading-[1.05] tracking-tighter">
          {ticket.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <time dateTime={ticket.createdAt}>
            {new Date(ticket.createdAt).toLocaleString()}
          </time>
          {ticket.kind === 'feature' && <span>· {ticket.voteCount} votes</span>}
          {!ticket.reporterVerified && (
            <Badge variant="ghost" className="gap-1 text-muted-foreground">
              <ShieldAlert className="size-3" /> unverified
            </Badge>
          )}
        </div>
      </header>

      <Separator />

      <div className="grid grid-cols-1 gap-10 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-10">
          <Section title="Description">
            <p className="whitespace-pre-wrap text-base leading-relaxed">{ticket.description}</p>
          </Section>

          {ticket.kind === 'bug' &&
            (ticket.stepsToReproduce || ticket.expectedBehavior || ticket.actualBehavior) && (
              <Section title="Reproduction">
                {ticket.stepsToReproduce && (
                  <Field label="Steps">{ticket.stepsToReproduce}</Field>
                )}
                {ticket.expectedBehavior && (
                  <Field label="Expected">{ticket.expectedBehavior}</Field>
                )}
                {ticket.actualBehavior && (
                  <Field label="Actual">{ticket.actualBehavior}</Field>
                )}
              </Section>
            )}

          {ticket.metadata && (
            <Section title="Browser context">
              <pre className="overflow-x-auto border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
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
                className="text-sm underline underline-offset-4 hover:text-primary"
              >
                Open screenshot ↗
              </a>
            </Section>
          )}

          <Section title="Notes">
            <NotesPanel
              value={ticket.notes ?? ''}
              onSave={(notes) => applyPatch({ notes })}
            />
          </Section>

          <Section title="Activity">
            <ActivityList events={events} onRevert={revertEvent} />
          </Section>
        </div>

        <aside className="space-y-6 md:sticky md:top-24 md:self-start">
          <MetaCard title="State">
            <StatusSelect
              value={ticket.status}
              disabled={mutating}
              onChange={(status) => void applyPatch({ status })}
            />
            <PrioritySelect
              value={ticket.priority}
              disabled={mutating}
              onChange={(priority) => void applyPatch({ priority })}
            />
            {mutError && (
              <p role="alert" className="text-xs text-destructive">
                {mutError}
              </p>
            )}
          </MetaCard>

          <MetaCard title="Reporter">
            <ReadonlyRow label="id" value={ticket.reporterId} mono />
            {ticket.reporterName && <ReadonlyRow label="name" value={ticket.reporterName} />}
            {ticket.reporterEmail && <ReadonlyRow label="email" value={ticket.reporterEmail} />}
            <ReadonlyRow
              label="verified"
              value={ticket.reporterVerified ? 'yes (HMAC)' : 'no'}
            />
            {!ticket.reporterVerified && (
              <p className="border-l-2 border-destructive/70 pl-3 text-[11px] leading-relaxed text-muted-foreground">
                Reporter was not verified. Any reply via the email they provided is self-asserted.
              </p>
            )}
          </MetaCard>
        </aside>
      </div>
    </div>
  );
}

/**
 * Private notes textarea, saved on demand. One field on the ticket,
 * not a stream — the solo admin doesn't need threaded notes, and
 * avoiding the comments table simplifies the server too.
 *
 * Save triggers an explicit PATCH rather than debouncing on every
 * keystroke: debouncing a save with no visible feedback would leave
 * the operator unsure whether their half-finished thought was
 * persisted. An explicit button also matches the model — notes are
 * settings-like, not chat-like.
 */
function NotesPanel({
  value,
  onSave,
}: {
  value: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Keep the draft in sync with incoming props (e.g. after a revert
  // refetches the ticket) as long as the operator isn't mid-edit.
  useEffect(() => {
    if (!submitting) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const dirty = draft !== value;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setSubmitting(false);
    }
  };

  const savedRecently = savedAt !== null && Date.now() - savedAt < 2000;

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Private scratch space. Never shown to the reporter."
        rows={4}
        maxLength={10_000}
        disabled={submitting}
      />
      <div className="flex items-center gap-3">
        {error ? (
          <p role="alert" className="flex-1 text-xs text-destructive">
            {error}
          </p>
        ) : savedRecently ? (
          <p className="flex-1 text-xs text-muted-foreground">Saved.</p>
        ) : null}
        <div className="ml-auto">
          <Button type="submit" size="sm" disabled={submitting || !dirty}>
            {submitting ? 'Saving…' : 'Save notes'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ActivityList({
  events,
  onRevert,
}: {
  events: TicketEvent[] | null;
  onRevert: (eventId: string) => Promise<void>;
}) {
  const [reverting, setReverting] = useState<string | null>(null);

  if (events === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No changes yet. Status and priority edits will show up here.
      </p>
    );
  }

  const handleRevert = async (eventId: string) => {
    setReverting(eventId);
    try {
      await onRevert(eventId);
    } finally {
      setReverting(null);
    }
  };

  return (
    <ol className="space-y-5 border-l border-border pl-5">
      {events.map((ev) => {
        const wasRevert = typeof (ev.payload as Record<string, unknown>).revertOf === 'string';
        return (
          <li
            key={ev.id}
            className={cn(
              'relative flex items-start gap-4',
              'before:absolute before:-left-[26px] before:top-2 before:size-2 before:rounded-full before:bg-border',
              wasRevert && 'before:bg-destructive/60',
            )}
          >
            <div className="flex-1 min-w-0 text-sm">
              <div>
                <span className="text-muted-foreground">
                  {describeEvent(ev)}
                  {wasRevert && <span className="ml-1">(revert)</span>}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {new Date(ev.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => void handleRevert(ev.id)}
                disabled={reverting !== null}
                className="underline underline-offset-4 hover:text-primary disabled:opacity-60"
              >
                {reverting === ev.id ? 'Reverting…' : 'Undo'}
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function describeEvent(ev: TicketEvent): string {
  if (ev.kind === 'status_changed') {
    const from = readString(ev.payload.from);
    const to = readString(ev.payload.to);
    return `Status changed from ${from} to ${to}`;
  }
  if (ev.kind === 'priority_changed') {
    const from = readString(ev.payload.from);
    const to = readString(ev.payload.to);
    return `Priority changed from ${from} to ${to}`;
  }
  return ev.kind;
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

function MetaCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border border-border bg-card p-4">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

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
    <EditRow label="Status">
      <Select
        value={value}
        onValueChange={(v) => onChange(v as TicketStatus)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </EditRow>
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
    <EditRow label="Priority">
      <Select
        value={value}
        onValueChange={(v) => onChange(v as TicketPriority)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </EditRow>
  );
}

function ReadonlyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</div>
      <div className={cn('text-sm', mono && 'break-all font-mono text-[11px]')}>{value}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      search={INBOX_DEFAULT_SEARCH}
      className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" /> Inbox
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{children}</div>
    </div>
  );
}
