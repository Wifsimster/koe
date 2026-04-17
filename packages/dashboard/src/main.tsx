import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './router';
import { AppProvider } from './context/AppContext';
import { LoginGate } from './components/LoginGate';
import './styles.css';

// Match the Vite `base` config so the SPA can be mounted under
// `/admin/*` when served by the Koe API, or at `/` in standalone dev.
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;
const router = createRouter({ routeTree, basepath });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// One client per app. Defaults tuned for an admin console: no
// refetch-on-focus (noisy for long-running triage sessions), short
// stale time so navigation doesn't show stale counts, retry turned
// off so a down API surfaces immediately instead of spinning.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 10_000,
      retry: 0,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <LoginGate>
          <RouterProvider router={router} />
        </LoginGate>
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);
