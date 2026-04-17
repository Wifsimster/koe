import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { useMe } from '../api/queries';
import { KoeApiError } from '../api/client';

/**
 * Minimal login gate for the `dev-session` admin auth mode. The user
 * pastes a token that was minted by the operator via the server-side
 * `admin-session` CLI. This is deliberately not a full login form —
 * the `dev-session` scheme has no password primitive. When we switch
 * to better-auth/OIDC, this component is replaced by an email/password
 * or redirect-to-IdP flow, and the token input goes away.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { client, token, setToken } = useApp();
  const me = useMe(client);

  // Unauthenticated path: show the token form. We also show it when
  // `me` returned 401 — a stale token is functionally the same.
  const unauthorized =
    me.error instanceof KoeApiError && me.error.code === 'unauthorized';

  if (!token || unauthorized) {
    return <TokenForm onSubmit={setToken} error={unauthorized ? 'Session expired or invalid.' : null} />;
  }

  if (me.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-gray-500">
        Loading session…
      </div>
    );
  }

  if (me.error) {
    return (
      <ErrorShell
        title="Could not reach the admin API"
        message={me.error instanceof Error ? me.error.message : String(me.error)}
        onRetry={() => me.refetch()}
        onLogout={() => setToken(null)}
      />
    );
  }

  return <>{children}</>;
}

function TokenForm({
  onSubmit,
  error,
}: {
  onSubmit: (token: string) => void;
  error: string | null;
}) {
  const [value, setValue] = useState('');
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }
  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold">Koe admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          Paste the session token your operator minted with{' '}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">pnpm admin-session</code>.
        </p>
        {error ? (
          <div className="mt-4 rounded bg-red-50 border border-red-200 text-sm text-red-700 px-3 py-2">
            {error}
          </div>
        ) : null}
        <label className="block mt-4 text-xs font-medium text-gray-700">Session token</label>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Bearer token"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function ErrorShell({
  title,
  message,
  onRetry,
  onLogout,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-red-700">{title}</h1>
        <p className="mt-1 text-sm text-gray-600">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-3 py-2"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-gray-300 text-sm font-medium px-3 py-2 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
