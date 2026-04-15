import { useState, type FormEvent } from 'react';
import { captureBrowserMetadata } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';

interface FormState {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  steps: '',
  expected: '',
  actual: '',
};

export function BugReportForm() {
  const { locale, api, config } = useKoe();
  const [state, setState] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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
    if (!state.title.trim()) nextErrors.title = 'Required';
    if (!state.description.trim()) nextErrors.description = 'Required';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await api.submitBugReport({
        projectKey: config.projectKey,
        title: state.title.trim(),
        description: state.description.trim(),
        stepsToReproduce: state.steps.trim() || undefined,
        expectedBehavior: state.expected.trim() || undefined,
        actualBehavior: state.actual.trim() || undefined,
        reporter: config.user ?? { id: 'anonymous' },
        metadata: captureBrowserMetadata(),
      });
      setSuccess(true);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const update = <K extends keyof FormState>(key: K) => (value: string) =>
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

      {apiError && (
        <div className="koe-mb-3 koe-text-xs koe-text-red-500" role="alert">
          {apiError}
        </div>
      )}

      <div className="koe-flex koe-justify-end">
        <Button type="submit" loading={submitting}>
          {locale.bugForm.submit}
        </Button>
      </div>
    </form>
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
