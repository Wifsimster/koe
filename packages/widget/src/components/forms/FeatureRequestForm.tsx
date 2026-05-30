import { useEffect, useReducer, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { captureBrowserMetadata, isValidEmail } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { KoeApiError } from '../../api/client';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';
import { SuccessMessage } from '../ui/SuccessMessage';

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

type FieldErrors = Partial<Record<keyof FormState, string>>;

interface FormData {
  values: FormState;
  errors: FieldErrors;
}

const INITIAL_FORM: FormData = { values: EMPTY, errors: {} };

type FormAction =
  | { type: 'setValue'; key: keyof FormState; value: string }
  | { type: 'setError'; key: keyof FormState; message: string | undefined }
  | { type: 'setErrors'; errors: FieldErrors }
  | { type: 'reset' };

/**
 * Field values and their validation errors travel together in one
 * reducer — every edit and every (re)validation is a single immutable
 * step, which keeps the form's hook count low and the two in sync.
 */
function formReducer(data: FormData, action: FormAction): FormData {
  switch (action.type) {
    case 'setValue':
      return { ...data, values: { ...data.values, [action.key]: action.value } };
    case 'setError':
      return { ...data, errors: { ...data.errors, [action.key]: action.message } };
    case 'setErrors':
      return { ...data, errors: action.errors };
    case 'reset':
      return INITIAL_FORM;
    default:
      return data;
  }
}

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
  const [form, dispatchForm] = useReducer(formReducer, INITIAL_FORM);
  const { values, errors } = form;
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  if (success) {
    return (
      <SuccessMessage
        emoji="✨"
        message={locale.featureForm.success}
        onDismiss={() => {
          setSuccess(false);
          dispatchForm({ type: 'reset' });
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
    dispatchForm({ type: 'setError', key, message: msg });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Bail on double-submit (typical: two clicks on the primary button)
    // before we set up a second AbortController and produce a duplicate
    // ticket on the server.
    if (submitting) return;
    setApiError(null);

    const nextErrors: FieldErrors = {};
    (['title', 'description', 'email'] as const).forEach((k) => {
      const msg = validateField(k, values[k]);
      if (msg) nextErrors[k] = msg;
    });
    dispatchForm({ type: 'setErrors', errors: nextErrors });
    if (Object.keys(nextErrors).length > 0) return;

    // Abort any previous in-flight request before assigning the new one
    // so we never leak a stale fetch — the early-return on `submitting`
    // covers normal cases but a controller can linger after an async
    // throw during a prior submit.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSubmitting(true);
    try {
      const baseReporter = config.user ?? { id: 'anonymous' };
      const finalEmail = values.email.trim() || baseReporter.email;
      const reporter = finalEmail ? { ...baseReporter, email: finalEmail } : baseReporter;

      await api.submitFeatureRequest(
        {
          title: values.title.trim(),
          description: values.description.trim(),
          reporter,
          metadata: captureBrowserMetadata(),
        },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setSuccess(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof KoeApiError) {
        if (err.code === 'network_error') {
          setApiError(locale.errors.network);
        } else if (err.code === 'rate_limited') {
          // Surface the retry hint when the server provides one so the
          // user knows the app isn't broken — just throttled.
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
      dispatchForm({ type: 'setValue', key, value });

  return (
    <form onSubmit={onSubmit} noValidate>
      <TextField
        autoFocus
        label={locale.featureForm.title}
        value={values.title}
        onChange={(e) => update('title')(e.target.value)}
        onBlur={onBlur('title')}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.featureForm.description}
        value={values.description}
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
          value={values.email}
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
