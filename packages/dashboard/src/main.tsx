import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './router';
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

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
