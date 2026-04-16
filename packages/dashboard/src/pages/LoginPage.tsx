import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';

/**
 * Interim login: paste a session token minted by the `admin-session`
 * CLI. Ugly on purpose — the real flow (OIDC redirect + callback)
 * replaces this page when MR #3c lands. Keeping the surface area small
 * so the replacement is a one-file swap.
 */
export function LoginPage() {
  const { login, state } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Paste the token printed by the admin-session CLI.');
      return;
    }
    setSubmitting(true);
    try {
      await login(trimmed);
      // AuthProvider's loader will validate the token against /me;
      // if the token is bad we end up back in `unauthenticated` and the
      // guard re-mounts this page with the error shown via state hook.
      await navigate({ to: '/' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 md:p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold mb-1">Koe admin</h1>
        <p className="text-sm text-gray-600 mb-6">
          Paste the session token printed by your{' '}
          <code className="px-1 bg-gray-100 rounded">admin-session</code> CLI.
        </p>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-gray-600 mb-1">Session token</span>
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            // 16px minimum kills iOS auto-zoom, same reason as the widget inputs.
            className="w-full text-base px-3 py-2 rounded-md border border-gray-300 bg-white focus:outline-none focus:border-indigo-500"
            placeholder="Paste token…"
            disabled={submitting}
          />
        </label>

        {error && (
          <div className="mb-4 text-xs text-red-600" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || state.status === 'loading'}
          className="w-full min-h-[44px] px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting || state.status === 'loading' ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-6 text-xs text-gray-500">
          Tokens expire. If yours is refused, mint a new one with:{' '}
          <code className="px-1 bg-gray-100 rounded whitespace-nowrap">
            pnpm --filter @koe/api exec tsx src/bin/admin-session.ts --email you@example.com
          </code>
        </p>
      </form>
    </div>
  );
}
