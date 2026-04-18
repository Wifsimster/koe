import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar';

export function ProjectSwitcher({ onChange }: { onChange?: () => void }) {
  const { state, setActiveProject } = useAuth();
  const navigate = useNavigate();
  if (state.status !== 'authenticated') return null;
  const projects = state.projects;
  const active = state.activeProjectKey;
  const activeProject = projects.find((p) => p.key === active) ?? projects[0];

  if (projects.length === 0) {
    // Reachable only if the router's empty-projects redirect fails to
    // fire — normal flow takes the user straight to /onboarding.
    return (
      <div className="rounded-none border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        No projects yet.{' '}
        <Link to="/onboarding" className="underline">
          Create your first project
        </Link>
        .
      </div>
    );
  }

  const onCreateProject = () => {
    onChange?.();
    void navigate({ to: '/onboarding' });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-auto gap-2 border border-border px-3 py-2 data-[state=open]:bg-muted"
            >
              <div className="grid flex-1 text-left">
                <span className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                  Project
                </span>
                <span className="truncate text-sm">
                  {activeProject?.name ?? 'Pick a project'}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56" side="bottom">
            <DropdownMenuLabel className="tracking-[0.18em] text-[10px] uppercase">
              Your projects
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.map((p) => {
              const isActive = p.key === active;
              return (
                <DropdownMenuItem
                  key={p.key}
                  onSelect={() => {
                    setActiveProject(p.key);
                    onChange?.();
                  }}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {isActive && <Check className="size-3.5" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreateProject}>
              <Plus className="size-3.5" />
              <span className="flex-1">Create project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
