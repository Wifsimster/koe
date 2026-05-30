import type { ReactNode } from 'react';

/**
 * Catch-all for unknown routes. Without it, an unrecognised URL would
 * render the route's empty children — i.e. a blank page — instead of
 * something the operator can act on.
 *
 * Lives in its own module (not `router.tsx`) so the router file exports
 * only route config: a file that mixes component and non-component
 * exports breaks React Fast Refresh.
 */
export function NotFoundView(): ReactNode {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        Kōe · 404
      </div>
      <h1 className="font-heading text-3xl tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That URL doesn't match anything in the dashboard.
      </p>
      <a
        href="/"
        className="text-sm underline underline-offset-4 hover:text-foreground"
      >
        Back to inbox
      </a>
    </div>
  );
}

/**
 * Top-level boundary for thrown loaders / route components. Without
 * one, a thrown route loader would surface as a blank screen.
 */
export function RouteErrorView({ error }: { error?: unknown }): ReactNode {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Something went wrong. Try reloading.';
  return (
    <div className="flex min-h-[40vh] flex-col items-start justify-center gap-3 p-6">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        Kōe · Error
      </div>
      <h2 className="font-heading text-2xl tracking-tight">Couldn't load this page</h2>
      <p
        role="alert"
        className="max-w-prose border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {message}
      </p>
    </div>
  );
}
