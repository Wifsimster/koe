import { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import type { AdminTicket } from '../api/client';

/**
 * Read-only ticket view. Mutations (status change, assignment, notes)
 * are intentionally out of scope until the triage flow tells us which
 * ones are worth wiring — we'll add them one at a time, each earning
 * its way in.
 *
 * The reporter's captured browser metadata is shown in a collapsible
 * block; it's noisy but critical when reproducing a bug.
 */
export function TicketDetailPage() {
  const { id } = useParams({ from: '/_authenticated/tickets/$id' });
  const { state, api } = useAuth();
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeKey = state.status === 'authenticated' ? state.activeProjectKey : null;

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
            <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3">
              <span>{new Date(ticket.createdAt).toLocaleString()}</span>
              <span>status: {ticket.status.replace('_', ' ')}</span>
              <span>priority: {ticket.priority}</span>
              {ticket.kind === 'feature' && <span>{ticket.voteCount} votes</span>}
            </div>
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
    </div>
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
