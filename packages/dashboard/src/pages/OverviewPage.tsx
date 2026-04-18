import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bug, Heart, Lightbulb, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { WorkspaceProjectSummary } from '../api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { cn } from '../lib/utils';

/**
 * Landing page for admins who belong to more than one project. Shows
 * one KPI tile per project in a responsive grid so an operator can see
 * the state of every project without navigating in. Click-through sets
 * the active project (so the shell's Inbox link retargets) and routes
 * to the inbox.
 */
export function OverviewPage() {
  const { api, setActiveProject } = useAuth();
  const [projects, setProjects] = useState<WorkspaceProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .workspaceOverview()
      .then((res) => {
        if (alive) setProjects(res.projects);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load overview');
      });
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (projects === null) {
    return <OverviewSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-6 py-10 text-center text-xs text-muted-foreground">
        You have no projects yet. Create one from the project switcher.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectTile key={p.id} project={p} onPick={setActiveProject} />
      ))}
    </div>
  );
}

function ProjectTile({
  project,
  onPick,
}: {
  project: WorkspaceProjectSummary;
  onPick: (key: string) => void;
}) {
  const { kpis } = project;
  const delta = kpis.activityLast7d - kpis.activityPrev7d;

  return (
    <Link
      to="/"
      search={INBOX_DEFAULT_SEARCH}
      onClick={() => onPick(project.key)}
      className="group outline-none"
    >
      <Card className="h-full transition-colors group-hover:ring-foreground/25 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: project.accentColor }}
            />
            <span className="truncate">{project.name}</span>
          </CardTitle>
          <CardDescription className="font-mono">{project.key}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <KpiRow
            icon={<Bug className="h-3.5 w-3.5" />}
            label="Open bugs"
            value={kpis.openBugs}
          />
          <KpiRow
            icon={<Lightbulb className="h-3.5 w-3.5" />}
            label="Open features"
            value={kpis.openFeatures}
          />
          <KpiRow
            icon={<Heart className="h-3.5 w-3.5" />}
            label="Feature votes"
            value={kpis.openFeatureVotes}
          />
          <KpiRow
            icon={<DeltaIcon delta={delta} />}
            label="7-day activity"
            value={kpis.activityLast7d}
            suffix={<DeltaBadge delta={delta} />}
          />
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiRow({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: React.ReactNode;
}) {
  const muted = value === 0;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn('font-heading text-xl tabular-nums', muted && 'text-muted-foreground')}
        >
          {value}
        </span>
        {suffix}
      </div>
    </div>
  );
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <TrendingUp className="h-3.5 w-3.5" />;
  if (delta < 0) return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={cn(
        'text-[10px] tabular-nums',
        positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
      )}
    >
      {positive ? '+' : ''}
      {delta}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="h-[160px]">
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="flex flex-col gap-1">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-5 w-10" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
