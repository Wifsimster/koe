import { useEffect, useRef, useState, type FormEvent } from 'react';
import { captureBrowserMetadata } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { KoeApiError } from '../../api/client';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';

interface FormState {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  email: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  steps: '',
  expected: '',
  actual: '',
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
  // Cancel the in-flight request if the widget closes mid-submit so we
  // don't update state on an unmounted component and don't waste bytes on
  // a response nobody will read.
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  if (success) {
    return (
      <SuccessMessage
        message={locale.bugForm.success}
        onDismiss={() => {
          setSuccess(false);
          setState(EMPTY);
        }}
      />
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    if (!state.title.trim()) nextErrors.title = locale.errors.required;
    if (!state.description.trim()) nextErrors.description = locale.errors.required;
    const trimmedEmail = state.email.trim();
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      nextErrors.email = locale.errors.invalidEmail;
    }
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
          stepsToReproduce: state.steps.trim() || undefined,
          expectedBehavior: state.expected.trim() || undefined,
          actualBehavior: state.actual.trim() || undefined,
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
        label={locale.bugForm.title}
        value={state.title}
        onChange={(e) => update('title')(e.target.value)}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.bugForm.description}
        value={state.description}
        onChange={(e) => update('description')(e.target.value)}
        error={errors.description}
        required
      />
      <TextAreaField
        label={locale.bugForm.steps}
        value={state.steps}
        onChange={(e) => update('steps')(e.target.value)}
        rows={2}
      />
      <TextAreaField
        label={locale.bugForm.expected}
        value={state.expected}
        onChange={(e) => update('expected')(e.target.value)}
        rows={2}
      />
      <TextAreaField
        label={locale.bugForm.actual}
        value={state.actual}
        onChange={(e) => update('actual')(e.target.value)}
        rows={2}
      />
      {/* Email field only shows when the host didn't already identify
          the user — otherwise it's redundant and adds friction. */}
      {!config.user?.email && (
        <TextField
          label={locale.bugForm.email ?? 'Email (optional)'}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={state.email}
          onChange={(e) => update('email')(e.target.value)}
          error={errors.email}
        />
      )}

      {apiError && (
        <div className="koe-mb-3 koe-text-xs koe-text-red-500" role="alert">
          {apiError}
        </div>
      )}

      <FormFooter>
        <Button type="submit" loading={submitting}>
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
  return (
    <div className="koe-panel-form-footer koe-flex koe-justify-end koe-gap-2">
      {children}
    </div>
  );
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
