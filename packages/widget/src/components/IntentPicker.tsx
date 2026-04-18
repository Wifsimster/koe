import clsx from 'clsx';
import { useKoe } from '../context/KoeContext';

export type Intent = 'bug' | 'feature';

export interface IntentPickerProps {
  onPick: (intent: Intent) => void;
}

/**
 * First-screen intent picker. Replaces the previous 3-tab top nav.
 *
 * Why a picker instead of tabs: on a 360px phone viewport the horizontal
 * tab strip ate ~40% of the header before the user had declared intent.
 * Asking "what's on your mind?" up front, with one tap to commit, is
 * faster one-handed and respects how people actually hold phones.
 *
 * Cards are intentionally 64px+ tall and full-width — thumb-reachable
 * without aiming, and WCAG 2.5.5 Large Target compliant.
 */
export function IntentPicker({ onPick }: IntentPickerProps) {
  const { locale, config } = useKoe();
  const features = config.features ?? { bugs: true, features: true };
  const picker = locale.picker ?? {
    prompt: "What's on your mind?",
    bug: 'Report a bug',
    bugHint: 'Something broken or confusing',
    feature: 'Suggest an idea',
    featureHint: 'New features, improvements',
  };

  const showBugs = features.bugs !== false;
  const showFeatures = features.features !== false;

  return (
    <div className="koe-flex koe-flex-col koe-gap-3">
      <p id="koe-picker-prompt" className="koe-label koe-m-0">
        {picker.prompt}
      </p>
      <div
        role="group"
        aria-labelledby="koe-picker-prompt"
        className="koe-flex koe-flex-col koe-gap-2"
      >
        {showBugs && (
          <IntentCard
            emoji="🐞"
            title={picker.bug}
            hint={picker.bugHint}
            onClick={() => onPick('bug')}
          />
        )}
        {showFeatures && (
          <IntentCard
            emoji="💡"
            title={picker.feature}
            hint={picker.featureHint}
            onClick={() => onPick('feature')}
          />
        )}
      </div>
    </div>
  );
}

interface IntentCardProps {
  emoji: string;
  title: string;
  hint: string;
  onClick: () => void;
}

function IntentCard({ emoji, title, hint, onClick }: IntentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'koe-flex koe-items-center koe-gap-3 koe-w-full koe-text-left',
        'koe-min-h-[64px] koe-px-4 koe-py-3',
        'koe-border koe-border-koe-border koe-bg-koe-bg',
        'hover:koe-border-koe-text focus:koe-outline-none focus-visible:koe-border-koe-text',
        'koe-transition-colors',
      )}
    >
      <span className="koe-text-xl koe-leading-none" aria-hidden="true">
        {emoji}
      </span>
      <span className="koe-flex koe-flex-col koe-min-w-0">
        <span className="koe-text-sm koe-font-medium koe-text-koe-text koe-truncate">{title}</span>
        <span className="koe-text-[11px] koe-text-koe-text-muted koe-truncate">{hint}</span>
      </span>
    </button>
  );
}
