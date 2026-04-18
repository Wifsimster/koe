import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { BatchSummary } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';

export function BatchesPage() {
  const { state, api } = useAuth();
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevert, setPendingRevert] = useState<BatchSummary | null>(null);
  const [reverting, setReverting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

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
      <div className="border border-dashed border-border bg-muted/30 p-8 text-sm text-muted-foreground">
        Pick a project from the sidebar to see its recent bulk actions.
      </div>
    );
  }

  const count = batches?.length ?? 0;

  return (
    <div className="space-y-10">
      <section>
        <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          Recent bulk actions
        </div>
        <div className="mt-1 flex items-baseline gap-4">
          <span className="font-heading text-[clamp(4rem,9vw,7rem)] leading-none tracking-tighter tabular-nums">
            {batches === null ? '—' : count}
          </span>
          <span className="font-heading text-2xl text-muted-foreground tracking-tight">
            {count === 1 ? 'batch' : 'batches'}
          </span>
        </div>
        <Separator className="mt-6" />
      </section>

      {notice && (
        <p role="status" className="border-l-2 border-primary/70 bg-primary/5 px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {batches === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : batches.length === 0 ? (
        <div className="border border-dashed border-border bg-muted/30 p-10 text-center">
          <p className="font-heading text-xl tracking-tight">Nothing to undo.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Once your team selects multiple tickets from the inbox and applies a change, the batch
            shows up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {batches.map((b) => (
            <li key={b.batchId} className="flex items-start gap-4 py-5">
              <BatchDate createdAt={b.createdAt} />
              <div className="min-w-0 flex-1">
                <div className="font-heading text-base tracking-tight">
                  {b.ticketCount} ticket{b.ticketCount === 1 ? '' : 's'} ·{' '}
                  <span className="text-muted-foreground">
                    {b.kinds.map(prettyKind).join(' + ')}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                  <span>
                    {b.eventCount} event{b.eventCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingRevert(b)}
                disabled={reverting}
              >
                Undo batch
              </Button>
            </li>
          ))}
        </ul>
      )}

      {pendingRevert && (
        <ConfirmDialog
          title="Undo this batch?"
          body={`${pendingRevert.ticketCount} ticket${
            pendingRevert.ticketCount === 1 ? '' : 's'
          } will be reverted where possible. Tickets that already moved past this batch will be skipped and reported.`}
          confirmLabel="Undo batch"
          submitting={reverting}
          onConfirm={() => void performRevert(pendingRevert)}
          onCancel={() => setPendingRevert(null)}
        />
      )}
    </div>
  );
}

function BatchDate({ createdAt }: { createdAt: string }) {
  const d = new Date(createdAt);
  return (
    <time
      dateTime={createdAt}
      className="hidden w-24 shrink-0 text-right md:block"
      title={d.toLocaleString()}
    >
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground/70">
        {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </div>
    </time>
  );
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'status_changed':
      return 'status';
    case 'priority_changed':
      return 'priority';
    case 'commented':
      return 'note';
    default:
      return kind;
  }
}
