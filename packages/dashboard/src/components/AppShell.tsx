import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Inbox, Layers, LogOut, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { ModeToggle } from './ModeToggle';
import { ProjectSwitcher } from './ProjectSwitcher';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar';

/**
 * Shell for the authenticated surface. Built on shadcn's Sidebar
 * primitives so the mobile drawer, keyboard shortcut (⌘/Ctrl+B), and
 * offcanvas behavior come for free.
 */
export function AppShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  const { state, logout } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (state.status !== 'authenticated') {
    return <div className="p-8 text-destructive">AppShell rendered without auth.</div>;
  }

  const isInbox = pathname === '/' || pathname.startsWith('/tickets');
  const isBatches = pathname.startsWith('/batches');
  const isMembers = /^\/projects\/[^/]+\/members$/.test(pathname);

  // The "Members" link routes to the active project's members page.
  // Resolved from `activeProjectKey` so switching projects re-targets
  // the link without remounting the nav.
  const activeMembership = state.activeProjectKey
    ? state.me.memberships.find((m) => m.projectKey === state.activeProjectKey)
    : null;

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas" className="z-20">
        <SidebarHeader className="gap-4 px-4 pt-5 pb-3">
          <Link
            to="/"
            search={INBOX_DEFAULT_SEARCH}
            className="flex items-baseline gap-2 outline-none"
          >
            <span className="font-heading text-3xl leading-none tracking-tight">Kōe</span>
            <span className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Admin
            </span>
          </Link>
          <ProjectSwitcher />
        </SidebarHeader>

        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="tracking-[0.2em] text-[10px]">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isInbox}>
                    <Link to="/" search={INBOX_DEFAULT_SEARCH}>
                      <Inbox />
                      <span>Inbox</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isBatches}>
                    <Link to="/batches">
                      <Layers />
                      <span>Recent batches</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {activeMembership && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isMembers}>
                      <Link
                        to="/projects/$key/members"
                        params={{ key: activeMembership.projectKey }}
                      >
                        <Users />
                        <span>Members</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-3 p-4">
          <Separator />
          <div className="space-y-1">
            <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Signed in
            </div>
            <div className="truncate text-xs">{state.me.user.email}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start px-2"
            onClick={() => void logout()}
          >
            <LogOut />
            Sign out
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="flex-1 min-w-0">{header}</div>
          <ModeToggle />
        </header>
        <main className="flex-1 px-4 py-8 md:px-12 md:py-12">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppFooter() {
  const buildDate = new Date(__BUILD_DATE__);
  const formattedDate = Number.isNaN(buildDate.getTime())
    ? __BUILD_DATE__
    : buildDate.toISOString().slice(0, 10);
  return (
    <footer className="border-t px-4 py-4 md:px-12">
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tracking-[0.18em] uppercase">Kōe · the voice, heard clearly</span>
        <span>
          v<span>{__APP_VERSION__}</span>
          <span className="mx-2">·</span>
          built <time dateTime={__BUILD_DATE__}>{formattedDate}</time>
        </span>
      </div>
    </footer>
  );
}
