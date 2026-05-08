import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { captureBrowserMetadata, isValidEmail } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { KoeApiError } from '../../api/client';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';
import { SuccessMessage } from '../ui/SuccessMessage';

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

export interface BugReportFormProps {
  /**
   * Optional callback that switches the widget to the "my requests"
   * screen. When provided, the success state exposes a secondary CTA
   * so the reporter can immediately see their just-submitted ticket
   * in context. Gated in the Panel on a verified user identity — we
   * never surface this for anonymous sessions.
   */
  onViewMyRequests?: () => void;
}

export function BugReportForm({ onViewMyRequests }: BugReportFormProps = {}) {
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
        emoji="✓"
        message={locale.bugForm.success}
        onDismiss={() => {
          setSuccess(false);
          setState(EMPTY);
          setErrors({});
        }}
        onViewMyRequests={onViewMyRequests}
        viewMyRequestsLabel={locale.myRequests?.title ?? 'My requests'}
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
    // A second submit while the first is in flight is almost always a
    // double-click on the submit button — bail before doing anything that
    // would let two POSTs race the API and produce duplicate tickets.
    if (submitting) return;
    setApiError(null);

    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    (['title', 'description', 'email'] as const).forEach((k) => {
      const msg = validateField(k, state[k]);
      if (msg) nextErrors[k] = msg;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Abort any previous in-flight request before assigning the new one.
    // The early-return above covers most cases, but a stale controller
    // can still linger if a previous submit threw asynchronously.
    controllerRef.current?.abort();
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
      if (err instanceof KoeApiError) {
        if (err.code === 'network_error') {
          setApiError(locale.errors.network);
        } else if (err.code === 'rate_limited') {
          // Surface the retry hint so the user knows the app is alive
          // and just throttled — not crashed. Bare `0` means the server
          // didn't send Retry-After, fall back to a generic phrasing.
          const retryAfter = err.detail.retryAfter ?? 0;
          setApiError(
            retryAfter > 0
              ? `Too many requests — please retry in ${retryAfter}s.`
              : 'Too many requests — please wait a moment and try again.',
          );
        } else if (err.code === 'unauthorized') {
          setApiError('Your session expired — please refresh the page and try again.');
        } else if (err.code === 'server_error') {
          setApiError('Koe is having trouble right now. Please try again in a minute.');
        } else {
          setApiError(err.message || locale.errors.generic);
        }
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
