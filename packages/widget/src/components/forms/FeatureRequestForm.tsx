import { useState, type FormEvent } from 'react';
import { captureBrowserMetadata } from '@koe/shared';
import { useKoe } from '../../context/KoeContext';
import { TextField, TextAreaField } from '../ui/Field';
import { Button } from '../ui/Button';

export function FeatureRequestForm() {
  const { locale, api, config } = useKoe();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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
            setTitle('');
            setDescription('');
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

    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = 'Required';
    if (!description.trim()) nextErrors.description = 'Required';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await api.submitFeatureRequest({
        title: title.trim(),
        description: description.trim(),
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

  return (
    <form onSubmit={onSubmit} noValidate>
      <TextField
        label={locale.featureForm.title}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={errors.title}
        required
      />
      <TextAreaField
        label={locale.featureForm.description}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        rows={4}
        required
      />

      {apiError && (
        <div className="koe-mb-3 koe-text-xs koe-text-red-500" role="alert">
          {apiError}
        </div>
      )}

      <div className="koe-flex koe-justify-end">
        <Button type="submit" loading={submitting}>
          {locale.featureForm.submit}
        </Button>
      </div>
    </form>
  );
}
