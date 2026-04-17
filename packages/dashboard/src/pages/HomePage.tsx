import { useApp } from '../context/AppContext';
import { useOverview, useProjects } from '../api/queries';
import { Badge, priorityTone, statusTone } from '../components/ui/Badge';
import { relativeTime } from '../lib/format';
import { Link } from '@tanstack/react-router';
import type { AdminProjectSummary } from '../api/client';

/**
 * Operator landing page. The widgets are backed by the `/overview`
 * endpoint plus the project list for install-health; everything is
 * scoped to the currently-selected project.
 */
export function HomePage() {
  const { client, projectKey } = useApp();
  const projects = useProjects(client);
  const overview = useOverview(client, projectKey);
  const current = projects.data?.find((p) => p.key === projectKey);

  if (!projectKey) {
    return <EmptyProjects />;
  }

  if (overview.isLoading || !overview.data) {
    return <Skeleton />;
  }

  const o = overview.data;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Overview</h2>
          <p className="text-sm text-gray-500">
            {current?.name ?? projectKey} · {current?.role ?? 'member'}
          </p>
        </div>
      </header>

      {current ? <InstallHealth project={current} /> : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Open bugs"
          value={o.openBugs}
          hint={
            o.criticalOpenBugs > 0
              ? `${o.criticalOpenBugs} critical`
              : undefined
          }
          tone={o.criticalOpenBugs > 0 ? 'danger' : 'neutral'}
          href="/bugs"
        />
        <StatCard label="Open feature requests" value={o.openFeatures} href="/features" />
        <StatCard
          label="Resolved (14d)"
          value={o.resolvedLast14d}
          hint={`${o.openedLast14d} opened`}
          tone="success"
        />
        <StatCard
          label="Throughput"
          value={
            o.openedLast14d === 0
              ? '—'
              : `${Math.round((o.resolvedLast14d / o.openedLast14d) * 100)}%`
          }
          hint="resolved / opened, 14d"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top voted this week">
          {o.topVotedThisWeek.length === 0 ? (
            <EmptyLine>No votes in the last 7 days.</EmptyLine>
          ) : (
            <ul className="divide-y divide-gray-100">
              {o.topVotedThisWeek.map((t) => (
                <li key={t.id} className="py-2 flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums w-10 text-right">
                    {t.voteCount ?? 0}
                  </span>
                  <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span>
                  <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity">
          {o.recent.length === 0 ? (
            <EmptyLine>Nothing yet — waiting for your first ticket.</EmptyLine>
          ) : (
            <ul className="divide-y divide-gray-100">
              {o.recent.map((t) => (
                <li key={t.id} className="py-2 flex items-center gap-3">
                  <Badge tone={t.kind === 'bug' ? 'danger' : 'info'}>{t.kind}</Badge>
                  <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span>
                  <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                  <span className="text-xs text-gray-400 w-20 text-right">
                    {relativeTime(t.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function InstallHealth({ project }: { project: AdminProjectSummary }) {
  const pinged = Boolean(project.lastPingAt);
  return (
    <section
      className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${
        pinged ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${pinged ? 'bg-emerald-500' : 'bg-amber-500'}`}
        aria-hidden
      />
      <div className="text-sm">
        {pinged ? (
          <>
            <span className="font-medium text-emerald-900">Widget is live.</span>{' '}
            <span className="text-emerald-800">
              Last ping from {project.lastPingOrigin ?? 'unknown origin'},{' '}
              {relativeTime(project.lastPingAt)}.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium text-amber-900">No pings yet.</span>{' '}
            <span className="text-amber-800">
              Check that the Koe snippet is installed on your site.
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'danger';
  href?: string;
}) {
  const accent =
    tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-600' : 'text-gray-900';
  const body = (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link to={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 py-2">{children}</p>;
}

function EmptyProjects() {
  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-semibold">No project selected</h2>
      <p className="mt-2 text-sm text-gray-600">
        You don’t have access to any projects yet. Ask an owner to add you to a project, or
        create one via the API.
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-gray-200 rounded-lg" />
        ))}
      </div>
      <div className="h-48 bg-gray-200 rounded-lg" />
    </div>
  );
}
