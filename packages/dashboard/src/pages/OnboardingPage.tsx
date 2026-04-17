import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { AdminApiError, type CreateProjectResult } from '../api/client';
import { INBOX_DEFAULT_SEARCH } from '../router';

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
    return (
      <Shell
        caption="Project created"
        subtitle={`${created.project.name} is ready. Copy the secret below — it is shown once.`}
      >
        <div className="space-y-6">
          <Field label="Project key">
            <CopyField value={created.project.key} />
          </Field>
          <Field
            label="Identity secret"
            hint="Keep this on your backend. Used to sign reporter identities. Never ship it to the browser."
          >
            <CopyField value={created.identitySecret} mono />
          </Field>
          <button
            type="button"
            onClick={() => void enterDashboard()}
            className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Enter dashboard
          </button>
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
        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-xs font-medium text-gray-700">
            Project name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Web"
            disabled={submitting}
            required
            autoFocus
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="key" className="block text-xs font-medium text-gray-700">
            Project key
          </label>
          <input
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
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-500">
            Used in API URLs and the widget's <Code>projectKey</Code>. Lowercase letters,
            digits, and dashes only.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="origins" className="block text-xs font-medium text-gray-700">
            Allowed origins
          </label>
          <textarea
            id="origins"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={'https://app.acme.com\nhttps://acme.com'}
            disabled={submitting}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-500">
            One per line. Leave empty in dev to accept any origin.
          </p>
        </div>
        <label className="flex items-start gap-3 pt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requireVerification}
            onChange={(e) => setRequireVerification(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm">
            <span className="font-medium text-gray-900 block">
              Require identity verification
            </span>
            <span className="text-xs text-gray-500">
              Reject widget submissions without a signed reporter hash. Turn this on once your
              backend is wired up.
            </span>
          </span>
        </label>
        {error && <ErrorLine>{error}</ErrorLine>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create project'}
        </button>
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
}: {
  caption: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Koe · Admin
          </div>
          <div className="text-xs uppercase tracking-wide text-gray-500">{caption}</div>
          <h2 className="text-2xl font-semibold text-gray-900">Set up</h2>
          <p className="text-sm text-gray-600">{subtitle}</p>
        </div>
        <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm">{children}</div>
      </div>
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
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
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
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={
          'flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm' +
          (mono ? ' font-mono text-xs' : '')
        }
      />
      <button
        type="button"
        onClick={() => void onCopy()}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700">
      {children}
    </p>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}
