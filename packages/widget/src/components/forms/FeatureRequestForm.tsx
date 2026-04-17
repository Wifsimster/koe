import { useEffect, useRef, useState, type FormEvent } from 'react';
import { captureBrowserMetadata } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { KoeApiError } from '../../api/client';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';

interface FormState {
  title: string;
  description: string;
  email: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  email: '',
};

// Minimal shape check. Empty strings are treated as "not provided" and
// skipped by the caller — the email field is optional.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value: string) => EMAIL_RE.test(value);

export function FeatureRequestForm() {
  const { locale, api, config } = useKoe();
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  if (success) {
    return (
      <div className="koe-text-center koe-py-6">
        <div className="koe-mb-3 koe-text-2xl">✨</div>
        <p className="koe-text-sm koe-mb-4">{locale.featureForm.success}</p>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setSuccess(false);
            setState(EMPTY);
          }}
        >
          Submit another
        </Button>
      </div>
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
      const baseReporter = config.user ?? { id: 'anonymous' };
      const finalEmail = trimmedEmail || baseReporter.email;
      const reporter = finalEmail ? { ...baseReporter, email: finalEmail } : baseReporter;

      await api.submitFeatureRequest(
        {
          title: state.title.trim(),
          description: state.description.trim(),
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
        label={locale.featureForm.title}
        value={state.title}
        onChange={(e) => update('title')(e.target.value)}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.featureForm.description}
        value={state.description}
        onChange={(e) => update('description')(e.target.value)}
        error={errors.description}
        rows={4}
        required
      />
      {!config.user?.email && (
        <TextField
          label={locale.featureForm.email ?? 'Email (optional)'}
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

      <div className="koe-panel-form-footer koe-flex koe-justify-end koe-gap-2">
        <Button type="submit" loading={submitting}>
          {locale.featureForm.submit}
        </Button>
      </div>
    </form>
  );
}
