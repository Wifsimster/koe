import { Check, ChevronsUpDown } from 'lucide-react';
import { Link } from '@tanstack/react-router';
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
  if (state.status !== 'authenticated') return null;
  const memberships = state.me.memberships;
  const active = state.activeProjectKey;
  const activeMembership = memberships.find((m) => m.projectKey === active) ?? memberships[0];

  if (memberships.length === 0) {
    // Reachable only if the router's empty-memberships redirect fails
    // to fire for some reason — normal flow takes the user straight to
    // /onboarding. Keep the message as a safety net that still offers
    // a way out.
    return (
      <div className="rounded-none border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        No project memberships yet.{' '}
        <Link to="/onboarding" className="underline">
          Create your first project
        </Link>
        .
      </div>
    );
  }

  if (memberships.length === 1) {
    return (
      <div className="border border-border bg-background px-3 py-2">
        <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          Project
        </div>
        <div className="truncate text-sm">{memberships[0]!.projectName}</div>
      </div>
    );
  }

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
                  {activeMembership?.projectName ?? 'Pick a project'}
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
            {memberships.map((m) => {
              const isActive = m.projectKey === active;
              return (
                <DropdownMenuItem
                  key={m.projectKey}
                  onSelect={() => {
                    setActiveProject(m.projectKey);
                    onChange?.();
                  }}
                >
                  <span className="flex-1 truncate">{m.projectName}</span>
                  {isActive && <Check className="size-3.5" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
