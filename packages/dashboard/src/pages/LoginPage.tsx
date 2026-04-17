import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';

/**
 * Login page, two modes:
 *
 *   oidc        → a single "Sign in" button that triggers the
 *                 full-page redirect to the OIDC provider. The user
 *                 never sees or handles a token.
 *   dev-session → paste-a-token form. Only used locally — the API
 *                 refuses to boot in this mode in production.
 */
export function LoginPage() {
  const { mode, login, state } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  if (mode === 'oidc') {
    return (
      <CardLayout
        title="Koe admin"
        subtitle="Sign in with your organization's identity provider."
      >
        <button
          type="button"
          onClick={() => void login()}
          className="w-full min-h-[44px] px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Sign in
        </button>
        <p className="mt-6 text-xs text-gray-500">
          You will be redirected to the identity provider configured for this deployment.
        </p>
      </CardLayout>
    );
  }

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
      await navigate({ to: '/' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CardLayout
      title="Koe admin"
      subtitle={
        <>
          Paste the session token printed by your{' '}
          <code className="px-1 bg-gray-100 rounded">admin-session</code> CLI.
        </>
      }
    >
      <form onSubmit={onSubmit}>
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
    </CardLayout>
  );
}

function CardLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 md:p-8 shadow-sm">
        <h1 className="text-xl font-semibold mb-1">{title}</h1>
        <p className="text-sm text-gray-600 mb-6">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
