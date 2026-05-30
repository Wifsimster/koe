import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, getRouteApi } from '@tanstack/react-router';
import { Bug, Globe, Heart, Lightbulb, Search as SearchIcon, ShieldAlert } from 'lucide-react';
import type { InboxSearch } from '../lib/searchParams';
import type { TicketKind, TicketPriority, TicketStatus } from '@koe/shared';
import { useAuth } from '../auth/AuthContext';
import type { AdminProject, AdminTicket } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HeartbeatBadge } from '../components/HeartbeatBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { cn } from '../lib/utils';

const inboxRoute = getRouteApi('/_authenticated/');

/**
 * Bulk-selection state lives in a reducer rather than four correlated
 * `useState`s: a single dispatch advances selection, confirm-gating, and
 * the in-flight/error flags in one immutable step, which keeps the
 * single-flight guard and the destructive-confirm flow honest.
 */
interface BulkState {
  selected: Set<string>;
  error: string | null;
  submitting: boolean;
  pending: { status: TicketStatus; count: number } | null;
}

const INITIAL_BULK: BulkState = {
  selected: new Set(),
  error: null,
  submitting: false,
  pending: null,
};

type BulkAction =
  | { type: 'toggle'; id: string }
  | { type: 'selectAll'; ids: string[] }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'submitStart' }
  | { type: 'submitDone' }
  | { type: 'submitError'; message: string }
  | { type: 'requestConfirm'; status: TicketStatus; count: number }
  | { type: 'cancelConfirm' };

function bulkReducer(state: BulkState, action: BulkAction): BulkState {
  switch (action.type) {
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case 'selectAll':
      return { ...state, selected: new Set(action.ids) };
    case 'clear':
      return { ...state, selected: new Set() };
    case 'reset':
      return { ...state, selected: new Set(), error: null };
    case 'submitStart':
      return { ...state, error: null, submitting: true };
    case 'submitDone':
      return { ...state, selected: new Set(), submitting: false };
    case 'submitError':
      return { ...state, error: action.message, submitting: false };
    case 'requestConfirm':
      return { ...state, pending: { status: action.status, count: action.count } };
    case 'cancelConfirm':
      return { ...state, pending: null };
    default:
      return state;
  }
}

export function InboxPage() {
  const { state, api } = useAuth();
  const [project, setProject] = useState<AdminProject | null>(null);
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { kind, status, q, sort } = inboxRoute.useSearch();
  const navigate = useNavigate();
  const patch = useCallback(
    (update: Partial<InboxSearch>, opts?: { replace?: boolean }) =>
      void navigate({
        to: '/',
        search: (prev) => ({ ...(prev as InboxSearch), ...update }),
        replace: opts?.replace,
      }),
    [navigate],
  );
  const [bulk, dispatch] = useReducer(bulkReducer, INITIAL_BULK);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

  useEffect(() => {
    if (!activeKey || state.status !== 'authenticated') {
      setProject(null);
      return;
    }
    setProject(state.projects.find((p) => p.key === activeKey) ?? null);
  }, [activeKey, state]);

  const loadTickets = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeKey) return;
      setError(null);
      try {
        // URL state defines render state — when the user ships `sort`
        // in the search params, honour it. Fall back to the previous
        // ad-hoc default (votes when filtering ideas) only when the
        // URL doesn't carry an explicit choice.
        const effectiveSort: 'recent' | 'votes' | undefined =
          sort === 'votes' ? 'votes' : kind === 'feature' && sort !== 'recent' ? 'votes' : sort;
        const page = await api.listTickets(
          activeKey,
          {
            kind: kind === 'all' ? undefined : kind,
            status: status === 'all' ? undefined : status,
            search: q ? q : undefined,
            sort: effectiveSort,
          },
          signal,
        );
        if (signal?.aborted) return;
        setTickets(page.items);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      }
    },
    [activeKey, api, kind, status, q, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadTickets(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadTickets]);

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [activeKey, kind, status, q, sort]);

  const applyBulk = useCallback(
    async (patch: { status?: TicketStatus; priority?: TicketPriority }) => {
      if (!activeKey || bulk.selected.size === 0) return;
      // Single-flight guard: the chip-level status `Select` and the
      // confirm-dialog can both call applyBulk; while one PATCH is
      // already in flight, drop subsequent invocations rather than
      // double-firing.
      if (bulk.submitting) return;
      dispatch({ type: 'submitStart' });
      try {
        await api.bulkUpdateTickets(activeKey, Array.from(bulk.selected), patch);
        dispatch({ type: 'submitDone' });
        await loadTickets();
      } catch (err) {
        dispatch({
          type: 'submitError',
          message: err instanceof Error ? err.message : 'Bulk update failed',
        });
      }
    },
    [activeKey, api, bulk.selected, bulk.submitting, loadTickets],
  );

  const requestBulkStatus = useCallback(
    (next: TicketStatus) => {
      // Mirror the destructive-confirm gate: while a non-destructive
      // bulk PATCH is in flight, ignore further requests.
      if (bulk.submitting) return;
      if (next === 'closed' || next === 'wont_fix') {
        dispatch({ type: 'requestConfirm', status: next, count: bulk.selected.size });
        return;
      }
      void applyBulk({ status: next });
    },
    [applyBulk, bulk.selected.size, bulk.submitting],
  );

  const toggleSelected = (id: string) => dispatch({ type: 'toggle', id });
  const selectAll = (ids: string[]) => dispatch({ type: 'selectAll', ids });
  const clearSelection = () => dispatch({ type: 'clear' });

  const counts = useMemo(() => {
    const map = { all: tickets?.length ?? 0, bug: 0, feature: 0 };
    for (const t of tickets ?? []) map[t.kind] += 1;
    return map;
  }, [tickets]);

  if (!activeKey) {
    return (
      <div className="border border-dashed border-border bg-muted/30 p-8 text-sm text-muted-foreground">
        Pick a project from the sidebar, or create one to start collecting tickets.
      </div>
    );
  }

  const hero = tickets?.length ?? 0;
  const heroLabel = hero === 1 ? 'voice' : 'voices';

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr] md:items-end">
          <div>
            <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
              {tickets === null ? 'Loading' : 'Currently matching'}
            </div>
            <div className="mt-1 flex items-baseline gap-4">
              <span className="font-heading text-[clamp(4rem,9vw,7rem)] leading-none tracking-tighter tabular-nums">
                {tickets === null ? '—' : hero}
              </span>
              <span className="font-heading text-2xl text-muted-foreground tracking-tight">
                {heroLabel}
              </span>
            </div>
          </div>
          {project && (
            <div className="md:pb-3">
              <HeartbeatBadge
                lastPingAt={project.lastPingAt}
                lastPingOrigin={project.lastPingOrigin}
                variant="block"
              />
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <SearchBox value={q} onChange={(v) => patch({ q: v }, { replace: true })} />
          <StatusSelect value={status} onChange={(v) => patch({ status: v })} />
        </div>

        <FilterChips
          kind={kind}
          onKindChange={(v) => patch({ kind: v })}
          counts={counts}
        />
      </section>

      {error && <ErrorLine>{error}</ErrorLine>}

      {bulk.selected.size > 0 && (
        <BulkToolbar
          count={bulk.selected.size}
          submitting={bulk.submitting}
          error={bulk.error}
          onStatus={requestBulkStatus}
          onPriority={(p) => void applyBulk({ priority: p })}
          onClear={clearSelection}
        />
      )}

      {bulk.pending && (
        <ConfirmDialog
          title={confirmTitleFor(bulk.pending.status, bulk.pending.count)}
          body={confirmBodyFor(bulk.pending.status)}
          confirmLabel={confirmLabelFor(bulk.pending.status)}
          submitting={bulk.submitting}
          onConfirm={async () => {
            const s = bulk.pending!.status;
            dispatch({ type: 'cancelConfirm' });
            await applyBulk({ status: s });
          }}
          onCancel={() => dispatch({ type: 'cancelConfirm' })}
        />
      )}

      {tickets === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tickets.length === 0 ? (
        <EmptyTickets project={project} />
      ) : (
        <section>
          {tickets && tickets.length > 0 && (
            <div className="flex items-center gap-3 border-y py-3 text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
              <Checkbox
                checked={
                  bulk.selected.size === tickets.length && tickets.length > 0
                    ? true
                    : bulk.selected.size > 0
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(checked) => {
                  if (checked === true) selectAll(tickets.map((t) => t.id));
                  else clearSelection();
                }}
                aria-label="Select all tickets on this page"
              />
              <span>
                {bulk.selected.size > 0
                  ? `${bulk.selected.size} of ${tickets.length} selected`
                  : 'Select all'}
              </span>
            </div>
          )}
          <ul className="divide-y">
            {(tickets ?? []).map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                selected={bulk.selected.has(t.id)}
                onToggleSelect={() => toggleSelected(t.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FilterChips({
  kind,
  onKindChange,
  counts,
}: {
  kind: TicketKind | 'all';
  onKindChange: (v: TicketKind | 'all') => void;
  counts: { all: number; bug: number; feature: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={kind === 'all'} onClick={() => onKindChange('all')}>
        All <Count>{counts.all}</Count>
      </Chip>
      <Chip active={kind === 'bug'} onClick={() => onKindChange('bug')}>
        <Bug className="size-3" />
        Bugs <Count>{counts.bug}</Count>
      </Chip>
      <Chip active={kind === 'feature'} onClick={() => onKindChange('feature')}>
        <Lightbulb className="size-3" />
        Ideas <Count>{counts.feature}</Count>
      </Chip>
    </div>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 font-mono text-[10px] text-muted-foreground">{children}</span>;
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
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // `draft` is fast local state; `value` is the committed URL param. We
  // reconcile during render (React's "adjust state when a prop changes"
  // pattern) instead of in an effect — that keeps the input focused
  // while typing, since nothing remounts and no effect re-syncs. The
  // last-seen `value` is tracked in a ref (not state): it's only read to
  // detect a change, never rendered, so it shouldn't trigger renders.
  const [draft, setDraft] = useState(() => value);
  const lastValueRef = useRef(value);
  if (value !== lastValueRef.current) {
    lastValueRef.current = value;
    setDraft(value);
  }
  // The debounce reads the latest `onChange` without re-subscribing when
  // the parent re-creates it every render. Effect Events always see the
  // current prop, so it stays out of the dependency array.
  const onChangeEvent = useEffectEvent(onChange);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChangeEvent(draft), 250);
    return () => clearTimeout(t);
  }, [draft, value]);
  return (
    <label htmlFor="inbox-search" className="relative block w-full md:max-w-sm">
      <span className="sr-only">Search tickets</span>
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id="inbox-search"
        type="search"
        placeholder="Search title, description, email…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={200}
        className="pl-8"
      />
    </label>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: TicketStatus | 'all';
  onChange: (v: TicketStatus | 'all') => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TicketStatus | 'all')}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Any status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Any status</SelectItem>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="in_progress">In progress</SelectItem>
        <SelectItem value="planned">Planned</SelectItem>
        <SelectItem value="resolved">Resolved</SelectItem>
        <SelectItem value="closed">Closed</SelectItem>
        <SelectItem value="wont_fix">Won't fix</SelectItem>
      </SelectContent>
    </Select>
  );
}

function TicketRow({
  ticket,
  selected,
  onToggleSelect,
}: {
  ticket: AdminTicket;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const isOpen = ticket.status === 'open';
  return (
    <li
      className={cn(
        'group relative flex items-start gap-3 py-4 transition-colors',
        selected && 'bg-muted/50',
      )}
    >
      {isOpen && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-4 bottom-4 w-[2px] bg-primary"
        />
      )}
      {/* Not a <label>: the Checkbox carries its own aria-label, and this
          wrapper exists only to stop a click in the checkbox gutter from
          bubbling to the row's <Link>. */}
      <div
        className="flex items-center pt-0.5 pl-3 pr-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ticket "${ticket.title}"`}
        />
      </div>
      <Link
        to="/tickets/$id"
        params={{ id: ticket.id }}
        className="flex-1 min-w-0 block py-0.5 pl-1 pr-3 outline-none group-hover:bg-muted/30 focus-visible:bg-muted/40"
      >
        <div className="flex items-start gap-3">
          {ticket.kind === 'feature' ? (
            <VoteGlyph count={ticket.voteCount} />
          ) : (
            <KindGlyph kind={ticket.kind} />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-base leading-snug tracking-tight text-foreground">
                {ticket.title}
              </h3>
              <StatusTag status={ticket.status} />
              {ticket.isPublicRoadmap && (
                <Badge variant="ghost" className="gap-1 text-muted-foreground">
                  <Globe className="size-3" /> On roadmap
                </Badge>
              )}
              {!ticket.reporterVerified && (
                <Badge variant="ghost" className="gap-1 text-muted-foreground">
                  <ShieldAlert className="size-3" /> unverified
                </Badge>
              )}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{ticket.description}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <time dateTime={ticket.createdAt}>
                {new Date(ticket.createdAt).toLocaleString()}
              </time>
              {ticket.reporterEmail && <span>{ticket.reporterEmail}</span>}
              {ticket.kind === 'feature' && (
                <span className="inline-flex items-center gap-1">
                  <Heart className="size-3" /> {ticket.voteCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function KindGlyph({ kind }: { kind: TicketKind }) {
  const Icon = kind === 'bug' ? Bug : Lightbulb;
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-flex size-6 shrink-0 items-center justify-center border border-border bg-card text-muted-foreground"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function VoteGlyph({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} ${count === 1 ? 'vote' : 'votes'}`}
      className="mt-1 inline-flex h-6 min-w-[2rem] shrink-0 items-center justify-center gap-1 border border-border bg-card px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground"
    >
      {count}
      <Heart className="size-3" aria-hidden="true" />
    </span>
  );
}

function BulkToolbar({
  count,
  submitting,
  error,
  onStatus,
  onPriority,
  onClear,
}: {
  count: number;
  submitting: boolean;
  error: string | null;
  onStatus: (v: TicketStatus) => void;
  onPriority: (v: TicketPriority) => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky top-[57px] z-10 -mx-4 border-y bg-secondary text-secondary-foreground md:-mx-12">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 text-sm md:px-12">
        <span className="font-heading text-base tracking-tight">
          <span className="font-mono tabular-nums">{count}</span> selected
        </span>
        <Separator orientation="vertical" className="h-5" />
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
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={onClear} disabled={submitting}>
            Clear
          </Button>
        </div>
        {error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
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
  const [resetKey, setResetKey] = useState(0);
  return (
    <Select
      key={resetKey}
      disabled={disabled}
      onValueChange={(v) => {
        onChange(v);
        setResetKey((k) => k + 1);
      }}
    >
      <SelectTrigger size="sm" className="w-[150px] bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusTag({ status }: { status: TicketStatus }) {
  const variant = statusVariant(status);
  return (
    <Badge variant={variant} className="tracking-[0.12em] uppercase">
      {status.replace('_', ' ')}
    </Badge>
  );
}

function statusVariant(s: TicketStatus): 'default' | 'secondary' | 'outline' | 'ghost' {
  switch (s) {
    case 'open':
      return 'default';
    case 'in_progress':
    case 'planned':
      return 'secondary';
    case 'resolved':
      return 'outline';
    case 'closed':
    case 'wont_fix':
      return 'ghost';
  }
}

function EmptyTickets({ project }: { project: AdminProject | null }) {
  return (
    <div className="border border-dashed border-border bg-muted/30 p-10 text-center">
      <p className="font-heading text-xl tracking-tight">Silence.</p>
      <p className="mt-2 text-sm text-muted-foreground">No tickets match these filters.</p>
      {project && !project.lastPingAt && (
        <p className="mt-4 text-xs text-muted-foreground">
          The widget hasn't pinged this project yet. Drop the{' '}
          <code className="border border-border bg-muted px-1 font-mono text-[11px]">
            &lt;script&gt;
          </code>{' '}
          tag into your app and reload, and you'll see a heartbeat within a minute.
        </p>
      )}
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {children}
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
  return "Won't-fix tells reporters you've decided not to take this on. The change shows up in each ticket's Activity log and can be reverted from the detail page.";
}

function confirmLabelFor(status: TicketStatus): string {
  if (status === 'closed') return 'Close tickets';
  return "Mark won't fix";
}
