import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function LoginPage() {
  const { login, state } = useAuth();
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
      void navigate({ to: '/', search: INBOX_DEFAULT_SEARCH });
    }
  }, [state.status, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Sign-in failed. Check your credentials and try again.',
      );
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
          the server. Generate a hash with{' '}
          <Code>docker compose run --rm api hash-password 'your-password'</Code>.
        </Hint>
      </form>
    </Shell>
  );
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
