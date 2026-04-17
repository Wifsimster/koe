import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { AdminApiError, type CreateProjectResult } from '../api/client';
import { INBOX_DEFAULT_SEARCH } from '../router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Textarea } from '../components/ui/textarea';

/**
 * First-project onboarding. Shown when an authenticated admin has zero
 * memberships — replaces the CLI `bootstrap` flow with an in-dashboard
 * form. After a successful create the result screen displays the
 * plaintext `identitySecret` exactly once: the server encrypts it at
 * rest and never returns it again, so copying it here is the operator's
 * only chance.
 */
export function OnboardingPage() {
  const { api, state, refreshMe, setActiveProject } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [origins, setOrigins] = useState('');
  const [requireVerification, setRequireVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreateProjectResult | null>(null);

  // Auto-derive the slug from the name until the operator edits the
  // key field themselves. Same rule the `bootstrap` CLI uses so the
  // muscle memory matches.
  const suggestedKey = keyDirty ? keyValue : slugify(name);

  if (state.status !== 'authenticated') {
    return null;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const finalKey = (keyDirty ? keyValue : slugify(name)).trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(finalKey)) {
      setError('Key must contain only lowercase letters, digits, and dashes.');
      return;
    }

    const allowedOrigins = origins
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const result = await api.createProject({
        name: trimmedName,
        key: finalKey,
        allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
        requireIdentityVerification: requireVerification || undefined,
      });
      // Refresh /me so the switcher and any other UI picks up the new
      // membership. Do it before we show the secret — if the refresh
      // 401s the auth layer kicks to /login, which is less jarring
      // than showing a secret that the rest of the UI can't see.
      await refreshMe();
      setActiveProject(result.project.key);
      setCreated(result);
    } catch (err) {
      setError(humaniseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const enterDashboard = async () => {
    await navigate({ to: '/', search: INBOX_DEFAULT_SEARCH });
  };

  if (created) {
    const apiUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://your-koe-host';
    const backendEnvSnippet = `KOE_IDENTITY_SECRET=${created.identitySecret}`;
    const backendSignSnippet = `// Your backend, never the browser.
import { createHmac } from 'node:crypto';

const userHash = createHmac('sha256', process.env.KOE_IDENTITY_SECRET)
  .update(user.id)
  .digest('hex');

// Send \`userHash\` to the browser alongside the user record.
res.json({ userHash });`;
    const reactSnippet = `import { KoeWidget } from '@wifsimster/koe';
import '@wifsimster/koe/style.css';

<KoeWidget
  projectKey="${created.project.key}"
  apiUrl="${apiUrl}"
  user={{ id: user.id, name: user.name, email: user.email }}
  userHash={userHash}
/>`;
    const scriptSnippet = `<link rel="stylesheet" href="https://unpkg.com/@wifsimster/koe/dist/style.css" />
<script src="https://unpkg.com/@wifsimster/koe/dist/koe.iife.js"></script>
<script>
  Koe.init({
    projectKey: '${created.project.key}',
    apiUrl: '${apiUrl}',
    user: { id: 'user_123', name: 'Jane Doe', email: 'jane@example.com' },
    userHash: 'hash-from-your-backend',
  });
</script>`;

    return (
      <Shell
        caption="Project created"
        subtitle={
          <>
            <strong className="text-foreground">{created.project.name}</strong> is ready. Follow
            the three steps below to wire up the widget. The identity secret is shown{' '}
            <em>once</em> — copy it now.
          </>
        }
        wide
      >
        <div className="space-y-8">
          <Callout>
            The identity secret below is encrypted at rest on the server and will never be shown
            again. If you lose it, you'll need to rotate it from the dashboard.
          </Callout>

          <Step
            index={1}
            title="Save the identity secret on your backend"
            body={
              <>
                Add this environment variable to the service that authenticates your users (the
                same place <Code>DATABASE_URL</Code> and your session secrets live). Your frontend
                must never see it.
              </>
            }
          >
            <Field label="Project key (public, safe to ship to the browser)">
              <CopyField value={created.project.key} />
            </Field>
            <Field
              label="Identity secret (keep secret, backend-only)"
              hint="Shown once — we store only an encrypted envelope."
            >
              <CopyField value={created.identitySecret} mono />
            </Field>
            <Field label="As an environment variable">
              <CodeBlock value={backendEnvSnippet} />
            </Field>
          </Step>

          <Step
            index={2}
            title="Sign the user id when you render the page"
            body={
              <>
                Compute an HMAC of <Code>user.id</Code> with the secret and hand it to the widget.
                This is what proves to Koe that the reporter is really your authenticated user.
              </>
            }
          >
            <CodeBlock value={backendSignSnippet} lang="ts" />
          </Step>

          <Step
            index={3}
            title="Mount the widget on your frontend"
            body={
              <>
                Pick the option that fits your stack. Both send the signed <Code>userHash</Code>{' '}
                back to Koe at <Code>{apiUrl}</Code>.
              </>
            }
          >
            <Field label="React / framework apps">
              <CodeBlock value={reactSnippet} lang="tsx" />
            </Field>
            <Field label="Plain HTML (script tag)">
              <CodeBlock value={scriptSnippet} lang="html" />
            </Field>
          </Step>

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void enterDashboard()}
          >
            I saved everything — enter the dashboard
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      caption="Welcome"
      subtitle="Create your first project to start collecting bugs and feature requests."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="tracking-[0.18em] text-[10px] uppercase">
            Project name
          </Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Web"
            disabled={submitting}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="key" className="tracking-[0.18em] text-[10px] uppercase">
            Project key
          </Label>
          <Input
            id="key"
            type="text"
            value={suggestedKey}
            onChange={(e) => {
              setKeyDirty(true);
              setKeyValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            placeholder="acme-web"
            disabled={submitting}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Used in API URLs and the widget's <Code>projectKey</Code>. Lowercase letters,
            digits, and dashes only.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="origins" className="tracking-[0.18em] text-[10px] uppercase">
            Allowed origins
          </Label>
          <Textarea
            id="origins"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={'https://app.acme.com\nhttps://acme.com'}
            disabled={submitting}
            rows={3}
          />
          <p className="text-[11px] text-muted-foreground">
            One per line. Leave empty in dev to accept any origin.
          </p>
        </div>
        <label className="flex items-start gap-3 pt-2">
          <Checkbox
            id="require-verification"
            checked={requireVerification}
            onCheckedChange={(v) => setRequireVerification(v === true)}
            disabled={submitting}
          />
          <span className="text-sm">
            <span className="font-medium block">Require identity verification</span>
            <span className="text-[11px] text-muted-foreground">
              Reject widget submissions without a signed reporter hash. Turn this on once your
              backend is wired up.
            </span>
          </span>
        </label>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create project'}
        </Button>
      </form>
    </Shell>
  );
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function humaniseError(err: unknown): string {
  if (err instanceof AdminApiError) {
    if (err.status === 409) {
      return err.message || 'A project with that key already exists. Pick a different key.';
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

function Shell({
  caption,
  subtitle,
  children,
  wide = false,
}: {
  caption: string;
  subtitle: ReactNode;
  children: ReactNode;
  /** Wider column for the post-create success screen with code blocks. */
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-start justify-center bg-background text-foreground p-6 py-12">
      <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
        <div className="mb-8 space-y-2">
          <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
            Kōe · Admin
          </div>
          <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            {caption}
          </div>
          <h2 className="font-heading text-2xl leading-tight tracking-tight">Set up</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  body,
  children,
}: {
  index: number;
  title: string;
  body: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Step {index}
          </span>
          <h3 className="font-heading text-lg leading-tight tracking-tight">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-foreground/60 bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function CodeBlock({ value, lang }: { value: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (non-https dev): operator can still select + copy.
    }
  };
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-sm border border-border bg-muted/40 p-4 text-[11px] leading-relaxed font-mono">
        <code>{value}</code>
      </pre>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={lang ? `Copy ${lang} snippet` : 'Copy snippet'}
        className="absolute top-2 right-2 rounded-sm border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="tracking-[0.18em] text-[10px] uppercase text-muted-foreground">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CopyField({ value, mono = false }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers block clipboard writes in non-https dev. The
      // value stays visible in the input — operator can select + copy.
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <Input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={mono ? 'font-mono text-xs' : ''}
      />
      <Button type="button" variant="outline" onClick={() => void onCopy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
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
