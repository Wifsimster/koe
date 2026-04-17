import type { TicketPriority, TicketStatus } from '@koe/shared';
import type { AdminTicket } from '../../api/client';
import { Badge, priorityTone, statusTone } from '../../components/ui/Badge';
import { relativeTime } from '../../lib/format';

const STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'planned',
  'resolved',
  'closed',
  'wont_fix',
];
const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'critical'];

/**
 * Right pane of the triage view. Status and priority are edited via
 * segmented controls — faster than dropdowns for the common flips
 * (open → in_progress → resolved) and every option is one click away.
 */
export function TicketDetail({
  ticket,
  onPatch,
  disabled,
}: {
  ticket: AdminTicket;
  onPatch: (patch: { status?: TicketStatus; priority?: TicketPriority }) => void;
  disabled?: boolean;
}) {
  const metadata = ticket.metadata as
    | { url?: string; userAgent?: string; viewport?: { width: number; height: number } }
    | null
    | undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge tone={ticket.kind === 'bug' ? 'danger' : 'info'}>{ticket.kind}</Badge>
          {ticket.reporterVerified ? <Badge tone="success">verified</Badge> : null}
          <span className="text-xs text-gray-400 ml-auto">
            opened {relativeTime(ticket.createdAt)}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900">{ticket.title}</h3>
        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ControlGroup label="Status">
          <Segmented
            value={ticket.status}
            options={STATUSES}
            toneOf={statusTone}
            disabled={disabled}
            onChange={(v) => onPatch({ status: v as TicketStatus })}
          />
        </ControlGroup>
        <ControlGroup label="Priority">
          <Segmented
            value={ticket.priority}
            options={PRIORITIES}
            toneOf={priorityTone}
            disabled={disabled}
            onChange={(v) => onPatch({ priority: v as TicketPriority })}
          />
        </ControlGroup>
      </div>

      {ticket.kind === 'bug' && (ticket.stepsToReproduce || ticket.expectedBehavior || ticket.actualBehavior) ? (
        <section className="space-y-3">
          {ticket.stepsToReproduce ? (
            <Field label="Steps to reproduce">{ticket.stepsToReproduce}</Field>
          ) : null}
          {ticket.expectedBehavior ? (
            <Field label="Expected">{ticket.expectedBehavior}</Field>
          ) : null}
          {ticket.actualBehavior ? (
            <Field label="Actual">{ticket.actualBehavior}</Field>
          ) : null}
        </section>
      ) : null}

      {ticket.screenshotUrl ? (
        <a
          href={ticket.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="block border border-gray-200 rounded overflow-hidden hover:border-indigo-400"
        >
          <img src={ticket.screenshotUrl} alt="Screenshot" className="w-full" />
        </a>
      ) : null}

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Meta label="Reporter">
          {ticket.reporterName ?? ticket.reporterEmail ?? ticket.reporterId}
        </Meta>
        <Meta label="Email">{ticket.reporterEmail ?? '—'}</Meta>
        {metadata?.url ? <Meta label="URL">{metadata.url}</Meta> : null}
        {metadata?.userAgent ? <Meta label="User agent">{metadata.userAgent}</Meta> : null}
        {metadata?.viewport ? (
          <Meta label="Viewport">
            {metadata.viewport.width}×{metadata.viewport.height}
          </Meta>
        ) : null}
        <Meta label="Updated">{relativeTime(ticket.updatedAt)}</Meta>
      </section>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  toneOf,
  onChange,
  disabled,
}: {
  value: T;
  options: readonly T[];
  toneOf: (v: string) => 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            onClick={() => !active && onChange(o)}
            className={
              active
                ? `px-2.5 py-1 rounded-md text-xs font-medium border border-transparent ring-1 ring-inset ${toneBg(toneOf(o))}`
                : 'px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50'
            }
          >
            {o.replace('_', ' ')}
          </button>
        );
      })}
    </div>
  );
}

function toneBg(tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'): string {
  switch (tone) {
    case 'danger':
      return 'bg-red-100 text-red-800 ring-red-200';
    case 'warning':
      return 'bg-amber-100 text-amber-800 ring-amber-200';
    case 'success':
      return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
    case 'info':
      return 'bg-blue-100 text-blue-800 ring-blue-200';
    default:
      return 'bg-gray-100 text-gray-800 ring-gray-200';
  }
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <p className="text-sm text-gray-800 whitespace-pre-wrap">{children}</p>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-xs text-gray-700 break-words">{children}</div>
    </div>
  );
}
