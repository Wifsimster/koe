import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bug, Heart, Lightbulb, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { WorkspaceProjectSummary } from '../api/client';
import { Button } from '../components/ui/button';
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
      <div className="rounded-md border border-dashed px-6 py-10 text-center">
        <p className="text-xs text-muted-foreground">You have no projects yet.</p>
        <Button asChild className="mt-4">
          <Link to="/onboarding">
            <Plus />
            Create your first project
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link to="/onboarding">
            <Plus />
            New project
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <ProjectTile key={p.id} project={p} onPick={setActiveProject} />
        ))}
      </div>
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
  const pick = () => onPick(project.key);

  return (
    <Card className="h-full">
      <CardHeader>
        <Link
          to="/"
          search={INBOX_DEFAULT_SEARCH}
          onClick={pick}
          className="group block outline-none"
        >
          <CardTitle className="flex items-center gap-2 group-hover:underline">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: project.accentColor }}
            />
            <span className="truncate">{project.name}</span>
          </CardTitle>
          <CardDescription className="font-mono">{project.key}</CardDescription>
        </Link>
      </CardHeader>
      <CardContent className="grid gap-3">
        <KpiLink
          to="/"
          search={{ ...INBOX_DEFAULT_SEARCH, kind: 'bug', status: 'open' }}
          onClick={pick}
          icon={<Bug className="h-3.5 w-3.5" />}
          label="Open bugs"
          value={kpis.openBugs}
        />
        <KpiLink
          to="/"
          search={{ ...INBOX_DEFAULT_SEARCH, kind: 'feature', status: 'open' }}
          onClick={pick}
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          label="Open ideas"
          value={kpis.openFeatures}
        />
        <KpiLink
          to="/"
          search={{ ...INBOX_DEFAULT_SEARCH, kind: 'feature', status: 'open', sort: 'votes' }}
          onClick={pick}
          icon={<Heart className="h-3.5 w-3.5" />}
          label="Idea votes"
          value={kpis.openFeatureVotes}
        />
      </CardContent>
    </Card>
  );
}

function KpiLink({
  to,
  search,
  onClick,
  icon,
  label,
  value,
}: {
  to: string;
  search: Record<string, unknown>;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const muted = value === 0;
  return (
    <Link
      to={to}
      search={search}
      onClick={onClick}
      className="group flex items-center justify-between gap-3 rounded-sm px-1 py-1 outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span
        className={cn('font-heading text-xl tabular-nums', muted && 'text-muted-foreground')}
      >
        {value}
      </span>
    </Link>
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
          <CardContent className="grid gap-3">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between gap-3">
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
