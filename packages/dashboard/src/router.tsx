import type { ReactNode } from 'react';
import {
  createRootRoute,
  createRoute,
  Outlet,
  Link,
  ErrorComponent,
  NotFoundRoute,
} from '@tanstack/react-router';
import { HomePage } from './pages/HomePage';
import { BugsPage } from './pages/BugsPage';
import { FeaturesPage } from './pages/FeaturesPage';
import { ChatPage } from './pages/ChatPage';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { useApp } from './context/AppContext';
import { useMe } from './api/queries';

const rootRoute = createRootRoute({
  component: RootLayout,
  // Catches render/loader errors anywhere in the tree so we don't
  // white-screen on a single failing endpoint.
  errorComponent: ({ error }) => (
    <div className="p-8 text-red-700">
      <h2 className="text-lg font-semibold mb-2">Something went wrong.</h2>
      <pre className="text-xs bg-red-50 border border-red-200 rounded p-3 overflow-auto">
        {error instanceof Error ? error.message : String(error)}
      </pre>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const bugsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bugs',
  component: BugsPage,
});

const featuresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/features',
  component: FeaturesPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
});

// Chat is flag-gated — if the env flag is false at build time the
// route is still registered (so deep links don't 404) but the page
// itself renders a coming-soon state. Hiding from nav happens in
// `RootLayout` below.
const children = [indexRoute, bugsRoute, featuresRoute, chatRoute];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const notFoundRoute = new NotFoundRoute({
  getParentRoute: () => rootRoute,
  component: () => (
    <div className="p-8">
      <h2 className="text-xl font-semibold">Not found</h2>
      <p className="text-gray-600 mt-1">
        That page isn’t part of the dashboard.{' '}
        <Link className="text-indigo-600 hover:underline" to="/">
          Back to overview
        </Link>
        .
      </p>
    </div>
  ),
});

export const routeTree = rootRoute.addChildren(children);

export { ErrorComponent };

function RootLayout() {
  const { client, setToken } = useApp();
  const me = useMe(client);
  const chatEnabled = import.meta.env.VITE_CHAT_ENABLED === 'true';

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Koe</h1>
          <p className="text-xs text-gray-500">Admin dashboard</p>
        </div>
        <div className="mb-6">
          <ProjectSwitcher />
        </div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/bugs">Bugs</NavLink>
          <NavLink to="/features">Feature requests</NavLink>
          {chatEnabled ? <NavLink to="/chat">Chat</NavLink> : null}
        </nav>
        <div className="mt-auto pt-4 border-t border-gray-100 text-xs text-gray-500">
          <div className="truncate">{me.data?.user.email ?? '—'}</div>
          <button
            type="button"
            onClick={() => setToken(null)}
            className="mt-2 text-indigo-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
      activeProps={{ className: 'px-3 py-2 rounded-md text-sm bg-indigo-50 text-indigo-700' }}
    >
      {children}
    </Link>
  );
}
