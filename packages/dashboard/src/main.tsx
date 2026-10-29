import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree, type RouterContext } from './router';
import { NotFoundView, RouteErrorView } from './components/RouteFallbacks';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './components/theme-provider';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/geist';
import './styles.css';

const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

const adminApiBaseUrl = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? '/v1/admin';

const router = createRouter({
  routeTree,
  basepath,
  context: undefined as unknown as RouterContext,
  defaultNotFoundComponent: NotFoundView,
  defaultErrorComponent: RouteErrorView,
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
