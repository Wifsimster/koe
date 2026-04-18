import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree, type RouterContext } from './router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './components/theme-provider';
import './styles.css';

// Match the Vite `base` config so the SPA can be mounted under
// `/admin/*` when served by the Koe API, or at `/` in standalone dev.
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

// Same-origin `/v1/admin` by default — the Hono server serves both
// the SPA and the JSON API. Override for a split deploy.
const adminApiBaseUrl = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? '/v1/admin';

const router = createRouter({
  routeTree,
  basepath,
  context: undefined as unknown as RouterContext,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ auth }} />;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider baseUrl={adminApiBaseUrl}>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
