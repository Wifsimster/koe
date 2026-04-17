import type { TicketPriority, TicketStatus } from '@koe/shared';
import type { TicketListQuery } from '../../api/client';

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
 * Filter bar for the ticket list. Controlled by the parent — keeps
 * URL-state migration easy when we wire it up later.
 */
export function TicketFilters({
  value,
  onChange,
  showKind,
}: {
  value: TicketListQuery;
  onChange: (next: TicketListQuery) => void;
  showKind?: boolean;
}) {
  function patch(p: Partial<TicketListQuery>) {
    // Reset cursor when any filter changes — otherwise we'd be paging
    // through the previous filter's result set.
    onChange({ ...value, ...p, cursor: undefined });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="search"
        placeholder="Search title or description…"
        value={value.search ?? ''}
        onChange={(e) => patch({ search: e.target.value || undefined })}
        className="rounded border border-gray-300 text-sm px-2 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {showKind ? (
        <Select
          label="Kind"
          value={value.kind ?? ''}
          onChange={(v) => patch({ kind: (v || undefined) as 'bug' | 'feature' | undefined })}
          options={[
            { label: 'All', value: '' },
            { label: 'Bugs', value: 'bug' },
            { label: 'Features', value: 'feature' },
          ]}
        />
      ) : null}

      <Select
        label="Status"
        value={value.status ?? ''}
        onChange={(v) => patch({ status: (v || undefined) as TicketStatus | undefined })}
        options={[
          { label: 'All', value: '' },
          ...STATUSES.map((s) => ({ label: s.replace('_', ' '), value: s })),
        ]}
      />

      <Select
        label="Priority"
        value={value.priority ?? ''}
        onChange={(v) => patch({ priority: (v || undefined) as TicketPriority | undefined })}
        options={[
          { label: 'All', value: '' },
          ...PRIORITIES.map((p) => ({ label: p, value: p })),
        ]}
      />

      <label className="flex items-center gap-1 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={value.verified === true}
          onChange={(e) => patch({ verified: e.target.checked ? true : undefined })}
          className="rounded"
        />
        Verified only
      </label>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <label className="flex items-center gap-1 text-sm text-gray-700">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
