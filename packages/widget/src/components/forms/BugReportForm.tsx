import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { captureBrowserMetadata } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { KoeApiError } from '../../api/client';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';

interface FormState {
  title: string;
  description: string;
  reproduce: string;
  email: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  reproduce: '',
  email: '',
};

// Minimal shape check. Empty strings are treated as "not provided" and
// skipped by the caller — the email field is optional.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value: string) => EMAIL_RE.test(value);

export function BugReportForm() {
  const { locale, api, config } = useKoe();
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // Cancel the in-flight request if the widget closes mid-submit so we
  // don't update state on an unmounted component and don't waste bytes on
  // a response nobody will read.
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Autofocus the first field so users can start typing immediately.
  useEffect(() => {
    if (!success) titleRef.current?.focus();
  }, [success]);

  if (success) {
    return (
      <SuccessMessage
        message={locale.bugForm.success}
        onDismiss={() => {
          setSuccess(false);
          setState(EMPTY);
          setErrors({});
        }}
      />
    );
  }

  const validateField = (key: keyof FormState, value: string): string | undefined => {
    if (key === 'title' || key === 'description') {
      if (!value.trim()) return locale.errors.required;
    }
    if (key === 'email') {
      const v = value.trim();
      if (v && !isValidEmail(v)) return locale.errors.invalidEmail;
    }
    return undefined;
  };

  const onBlur = (key: keyof FormState) => (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const msg = validateField(key, e.target.value);
    setErrors((prev) => ({ ...prev, [key]: msg }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    (['title', 'description', 'email'] as const).forEach((k) => {
      const msg = validateField(k, state[k]);
      if (msg) nextErrors[k] = msg;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setSubmitting(true);
    try {
      // The host-supplied user object wins over a widget-collected email.
      // Only borrow the optional field when the host didn't give us one.
      const baseReporter = config.user ?? { id: 'anonymous' };
      const email = state.email.trim() || baseReporter.email;
      const reporter = email ? { ...baseReporter, email } : baseReporter;

      await api.submitBugReport(
        {
          title: state.title.trim(),
          description: state.description.trim(),
          stepsToReproduce: state.reproduce.trim() || undefined,
          reporter,
          metadata: captureBrowserMetadata(),
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setSuccess(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof KoeApiError && err.code === 'network_error') {
        setApiError(locale.errors.network);
      } else {
        setApiError(err instanceof Error ? err.message : locale.errors.generic);
      }
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  };

  const update =
    <K extends keyof FormState>(key: K) =>
    (value: string) =>
      setState((s) => ({ ...s, [key]: value }));

  return (
    <form onSubmit={onSubmit} noValidate>
      <TextField
        ref={titleRef}
        label={locale.bugForm.title}
        value={state.title}
        onChange={(e) => update('title')(e.target.value)}
        onBlur={onBlur('title')}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.bugForm.description}
        value={state.description}
        onChange={(e) => update('description')(e.target.value)}
        onBlur={onBlur('description')}
        error={errors.description}
        required
      />
      <TextAreaField
        label={locale.bugForm.reproduce}
        value={state.reproduce}
        onChange={(e) => update('reproduce')(e.target.value)}
        rows={3}
      />
      {/* Email field only shows when the host didn't already identify
          the user — otherwise it's redundant and adds friction. */}
      {!config.user?.email && (
        <TextField
          label={locale.bugForm.email ?? 'Email · optional'}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={state.email}
          onChange={(e) => update('email')(e.target.value)}
          onBlur={onBlur('email')}
          error={errors.email}
        />
      )}

      {apiError && (
        <div className="koe-mb-3 koe-text-xs koe-text-red-500" role="alert">
          {apiError}
        </div>
      )}

      <FormFooter>
        <Button type="submit" loading={submitting} block>
          {locale.bugForm.submit}
        </Button>
      </FormFooter>
    </form>
  );
}

/**
 * Sticky footer keeps the primary action reachable above the mobile
 * virtual keyboard. Pairs with `--koe-vvh` written by
 * `useVisualViewport` and the bottom-sheet CSS rules — together they
 * keep the form scrollable area shrinking to track the visible viewport
 * as the keyboard pops.
 */
function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="koe-panel-form-footer">{children}</div>;
}

function SuccessMessage({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="koe-text-center koe-py-6">
      <div className="koe-mb-3 koe-text-2xl">✓</div>
      <p className="koe-text-sm koe-mb-4">{message}</p>
      <Button variant="ghost" type="button" onClick={onDismiss}>
        Submit another
      </Button>
    </div>
  );
}
