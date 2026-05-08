import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { AdminApiError } from '../api/client';
import { INBOX_DEFAULT_SEARCH, loginRoute } from '../router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const GENERIC_AUTH_ERROR = 'Invalid email or password.';
const AUTH_ERROR_CODES = new Set([
  'unauthorized',
  'forbidden',
  'invalid_credentials',
  'not_found',
  'validation_failed',
]);

export function LoginPage() {
  const { login, state } = useAuth();
  const { redirectTo } = loginRoute.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Post-login navigation is driven by an effect so the router sees
  // the new auth state on its next commit. Calling navigate
  // synchronously would race the AuthProvider's transition and bounce
  // back to /login.
  const pendingNavRef = useRef(false);
  useEffect(() => {
    if (pendingNavRef.current && state.status === 'authenticated') {
      pendingNavRef.current = false;
      // `redirectTo` was validated by `loginRoute.validateSearch` —
      // it's guaranteed same-origin relative or undefined here. Falling
      // back to `/` lets the existing landing logic (multi-project
      // overview, single-project inbox) route the user.
      if (redirectTo) {
        void navigate({ to: redirectTo });
      } else {
        void navigate({ to: '/', search: INBOX_DEFAULT_SEARCH });
      }
    }
  }, [state.status, navigate, redirectTo]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Hard early-return: while a previous submit is still in flight,
    // ignore the second click (or Enter keypress).
    if (submitting || pendingNavRef.current) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      pendingNavRef.current = true;
    } catch (err) {
      setError(formatLoginError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell caption="Admin sign-in" subtitle="Sign in with your admin credentials.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="tracking-[0.18em] text-[10px] uppercase">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="tracking-[0.18em] text-[10px] uppercase">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            disabled={submitting}
            required
          />
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={submitting || state.status === 'loading'}
        >
          {submitting || state.status === 'loading' ? 'Signing in…' : 'Sign in'}
        </Button>
        <Hint>
          Credentials live in <Code>ADMIN_EMAIL</Code> and <Code>ADMIN_PASSWORD_HASH</Code> on
          the server. Generate a hash interactively with{' '}
          <Code>docker compose run --rm api hash-password</Code>. Forgot the password? Run the
          same command, replace the hash in <Code>.env</Code>, and restart the container.
        </Hint>
      </form>
    </Shell>
  );
}

/**
 * Map auth-related error codes to a single opaque string. The server
 * may distinguish "no such email" from "wrong password" for its own
 * logs, but echoing those distinctions to the browser would let an
 * attacker enumerate which emails have an account. Network/server
 * problems still surface verbatim so the operator can see what's
 * broken.
 */
function formatLoginError(err: unknown): string {
  if (err instanceof AdminApiError) {
    if (AUTH_ERROR_CODES.has(err.code)) return GENERIC_AUTH_ERROR;
    if (err.code === 'rate_limited') {
      return err.message || 'Too many attempts. Please wait and try again.';
    }
    if (err.code === 'network_error') {
      return err.message || 'Network error. Check your connection and try again.';
    }
    if (err.code === 'server_error') {
      return err.message || 'The server is having trouble. Try again in a moment.';
    }
    // Unknown / non-auth: echo verbatim — useful for legitimate
    // unexpected failures.
    return err.message || GENERIC_AUTH_ERROR;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Sign-in failed. Check your credentials and try again.';
}

function Shell({
  caption,
  subtitle,
  children,
}: {
  caption: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-5 bg-background text-foreground">
      <aside className="relative hidden md:col-span-2 md:flex md:flex-col md:justify-between bg-muted/30 border-r p-12">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
            Kōe · Admin
          </div>
        </div>
        <div>
          <h1 className="font-heading text-[clamp(4rem,7vw,7rem)] leading-[0.9] tracking-tighter">
            The voice,
            <br />
            <span className="text-muted-foreground/60">heard clearly.</span>
          </h1>
          <p className="mt-6 max-w-sm text-sm text-muted-foreground">
            Triage bugs, shape the roadmap, close the loop with the people who reported them.
          </p>
        </div>
        <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          声 — Koe
        </div>
      </aside>

      <main className="md:col-span-3 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="md:hidden mb-10">
            <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
              Kōe · Admin
            </div>
            <h1 className="mt-2 font-heading text-5xl leading-none tracking-tighter">
              The voice.
            </h1>
          </div>

          <div className="mb-8 space-y-2">
            <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              {caption}
            </div>
            <h2 className="font-heading text-2xl leading-tight tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">{children}</p>;
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-2 border-destructive/70 pl-3 text-xs text-destructive">
      {children}
    </p>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
      {children}
    </code>
  );
}
