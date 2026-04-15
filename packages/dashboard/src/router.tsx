import type { ReactNode } from 'react';
import { createRootRoute, createRoute, Outlet, Link } from '@tanstack/react-router';
import { HomePage } from './pages/HomePage';
import { BugsPage } from './pages/BugsPage';
import { FeaturesPage } from './pages/FeaturesPage';
import { ChatPage } from './pages/ChatPage';

const rootRoute = createRootRoute({
  component: RootLayout,
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

export const routeTree = rootRoute.addChildren([indexRoute, bugsRoute, featuresRoute, chatRoute]);

function RootLayout() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-white border-r border-gray-200 p-4">
        <div className="mb-8">
          <h1 className="text-xl font-bold">Koe</h1>
          <p className="text-xs text-gray-500">Admin dashboard</p>
        </div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/bugs">Bugs</NavLink>
          <NavLink to="/features">Feature requests</NavLink>
          <NavLink to="/chat">Chat</NavLink>
        </nav>
      </aside>
      <main className="flex-1 p-8">
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
