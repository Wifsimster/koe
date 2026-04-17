import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { BatchSummary } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';

/**
 * Recent bulk actions panel.
 *
 * Before this page, a bulk mutation was only reachable per-ticket
 * via Activity. Ops who wanted to reverse a batch had to find a
 * ticket that was in it, which is hunting-around behaviour. This
 * page lists recent batches project-wide and offers the same
 * `Undo batch` action directly.
 *
 * Read is open to all members (including viewers) — knowing what
 * the team has been doing is informational. The action button only
 * renders for writers, same rule the server enforces.
 */
export function BatchesPage() {
  const { state, api } = useAuth();
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevert, setPendingRevert] = useState<BatchSummary | null>(null);
  const [reverting, setReverting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

  const role =
    state.status === 'authenticated'
      ? state.me.memberships.find((m) => m.projectKey === activeKey)?.role ?? 'viewer'
      : 'viewer';
  const canWrite = role === 'owner' || role === 'member';

  const load = useCallback(async () => {
    if (!activeKey) return;
    setError(null);
    try {
      const rows = await api.listEventBatches(activeKey);
      setBatches(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batches');
    }
  }, [activeKey, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const performRevert = async (batch: BatchSummary) => {
    if (!activeKey) return;
    setReverting(true);
    try {
      const res = await api.revertEventBatch(activeKey, batch.batchId);
      setPendingRevert(null);
      setNotice(
        res.skipped.length === 0
          ? `Batch reverted: ${res.reverted} change${res.reverted === 1 ? '' : 's'} rolled back.`
          : `Batch partially reverted: ${res.reverted} succeeded, ${res.skipped.length} skipped.`,
      );
      void load();
    } catch (err) {
      setPendingRevert(null);
      setError(err instanceof Error ? err.message : 'Batch revert failed');
    } finally {
      setReverting(false);
    }
  };

  if (!activeKey) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
        Pick a project from the sidebar to see its recent bulk actions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role="status"
          className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-3"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3"
        >
          {error}
        </div>
      )}

      {batches === null ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600 text-center">
          No bulk actions yet. Once your team selects multiple tickets from the inbox and applies a
          change, the batch shows up here.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
          {batches.map((b) => (
            <li key={b.batchId} className="p-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 font-medium">
                  {b.ticketCount} ticket{b.ticketCount === 1 ? '' : 's'} ·{' '}
                  {b.kinds.map(prettyKind).join(' + ')}
                </div>
                <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3">
                  <span>{new Date(b.createdAt).toLocaleString()}</span>
                  <span>by {b.actorDisplayName ?? b.actorEmail ?? 'deleted user'}</span>
                  <span>{b.eventCount} event{b.eventCount === 1 ? '' : 's'}</span>
                </div>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setPendingRevert(b)}
                  disabled={reverting}
                  className="text-xs text-indigo-700 hover:text-indigo-900 underline underline-offset-2 disabled:opacity-60 shrink-0 min-h-[36px]"
                >
                  Undo batch
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingRevert && (
        <ConfirmDialog
          title={`Undo this batch?`}
          body={`${pendingRevert.ticketCount} ticket${
            pendingRevert.ticketCount === 1 ? '' : 's'
          } will be reverted where possible. Tickets that already moved past this batch (or whose original assignee left) will be skipped and reported.`}
          confirmLabel="Undo batch"
          submitting={reverting}
          onConfirm={() => void performRevert(pendingRevert)}
          onCancel={() => setPendingRevert(null)}
        />
      )}
    </div>
  );
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'status_changed':
      return 'status';
    case 'priority_changed':
      return 'priority';
    case 'assigned':
      return 'assignee';
    case 'commented':
      return 'comment';
    default:
      return kind;
  }
}
