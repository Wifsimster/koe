import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
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

export interface FeatureRequestFormProps {
  /**
   * Optional callback that switches the widget to the "my requests"
   * screen so the reporter can see their just-submitted suggestion in
   * context. Gated by the Panel on a verified user identity.
   */
  onViewMyRequests?: () => void;
}

export function FeatureRequestForm({ onViewMyRequests }: FeatureRequestFormProps = {}) {
  const { locale, api, config } = useKoe();
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!success) titleRef.current?.focus();
  }, [success]);

  if (success) {
    return (
      <div className="koe-text-center koe-py-6">
        <div className="koe-mb-3 koe-text-2xl">✨</div>
        <p className="koe-text-sm koe-mb-4">{locale.featureForm.success}</p>
        <div className="koe-flex koe-flex-col koe-items-center koe-gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setSuccess(false);
              setState(EMPTY);
              setErrors({});
            }}
          >
            Submit another
          </Button>
          {onViewMyRequests && (
            <Button variant="outline" type="button" onClick={onViewMyRequests}>
              {locale.myRequests?.title ?? 'My requests'}
            </Button>
          )}
        </div>
      </div>
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
      const baseReporter = config.user ?? { id: 'anonymous' };
      const finalEmail = state.email.trim() || baseReporter.email;
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
        ref={titleRef}
        label={locale.featureForm.title}
        value={state.title}
        onChange={(e) => update('title')(e.target.value)}
        onBlur={onBlur('title')}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.featureForm.description}
        value={state.description}
        onChange={(e) => update('description')(e.target.value)}
        onBlur={onBlur('description')}
        error={errors.description}
        rows={4}
        required
      />
      {!config.user?.email && (
        <TextField
          label={locale.featureForm.email ?? 'Email · optional'}
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

      <div className="koe-panel-form-footer">
        <Button type="submit" loading={submitting} block>
          {locale.featureForm.submit}
        </Button>
      </div>
    </form>
  );
}
