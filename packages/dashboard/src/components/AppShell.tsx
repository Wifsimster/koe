import type { ReactNode } from 'react';
import { useState } from 'react';
import clsx from 'clsx';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { ProjectSwitcher } from './ProjectSwitcher';

/**
 * Layout shell for the authenticated surface.
 *
 * Posture per viewport:
 *   - ≥ 768px: persistent left sidebar (nav + project switcher + user).
 *   - <  768px: top bar with a hamburger that pops a full-height drawer.
 *
 * Triage is the job-to-be-done on mobile (PO clearing an inbox from
 * the train), so the layout treats the inbox as the main surface
 * rather than a nested view behind a sidebar.
 */
export function AppShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  const { state, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (state.status !== 'authenticated') {
    // AppShell is only mounted by authenticated routes. If we render
    // at any other state, the router guard is buggy — make it loud.
    return <div className="p-8 text-red-600">AppShell rendered without auth.</div>;
  }

  const closeDrawer = () => setDrawerOpen(false);

  const nav = (
    <nav className="flex flex-col gap-1">
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Project</div>
      <div className="px-3 pb-3">
        <ProjectSwitcher onChange={closeDrawer} />
      </div>

      <div className="mt-2 border-t border-gray-200 pt-3 px-3 text-xs uppercase tracking-wide text-gray-500">
        Pages
      </div>
      <Link
        to="/"
        search={INBOX_DEFAULT_SEARCH}
        onClick={closeDrawer}
        className="mx-3 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
        activeProps={{ className: 'mx-3 px-3 py-2 rounded-md text-sm bg-indigo-50 text-indigo-700' }}
        activeOptions={{ exact: true }}
      >
        Inbox
      </Link>
      <Link
        to="/batches"
        onClick={closeDrawer}
        className="mx-3 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
        activeProps={{ className: 'mx-3 px-3 py-2 rounded-md text-sm bg-indigo-50 text-indigo-700' }}
      >
        Recent batches
      </Link>

      <div className="mt-2 border-t border-gray-200 pt-3 px-3 text-xs text-gray-500 truncate">
        {state.me.user.email}
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        className="mx-3 mt-1 text-left px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
      >
        Sign out
      </button>
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Desktop sidebar. */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:shrink-0 bg-white border-r border-gray-200 p-4">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Koe</h1>
          <p className="text-xs text-gray-500">Admin dashboard</p>
        </div>
        {nav}
      </aside>

      {/* Mobile top bar + drawer. */}
      <div className="md:hidden bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            // 44px tap target — same WCAG rule as the widget, same reason.
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2"
          >
            <BurgerIcon />
          </button>
          <h1 className="text-base font-semibold">Koe</h1>
          <div className="w-[44px]" aria-hidden="true" />
        </div>
        {drawerOpen && (
          <div className="border-t border-gray-200 pb-4 bg-white">
            <div className="mb-2" />
            {nav}
          </div>
        )}
      </div>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-8">
          <div className={clsx('mb-6')}>{header}</div>
          {children}
        </div>
        <AppFooter />
      </main>
    </div>
  );
}

function AppFooter() {
  const buildDate = new Date(__BUILD_DATE__);
  const formattedDate = Number.isNaN(buildDate.getTime())
    ? __BUILD_DATE__
    : buildDate.toISOString().slice(0, 10);
  return (
    <footer className="border-t border-gray-200 px-4 md:px-8 py-3 text-xs text-gray-500">
      <div className="max-w-4xl mx-auto flex flex-wrap gap-x-4 gap-y-1 justify-between">
        <span>
          Koe Dashboard <span className="font-mono">v{__APP_VERSION__}</span>
        </span>
        <span>
          Built <time dateTime={__BUILD_DATE__}>{formattedDate}</time>
        </span>
      </div>
    </footer>
  );
}

function BurgerIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}
