import clsx from 'clsx';
import { useKoe } from '../context/KoeContext';

export type Intent = 'bug' | 'feature' | 'vote' | 'my-requests';

export interface IntentPickerProps {
  onPick: (intent: Intent) => void;
}

/**
 * First-screen intent picker. Replaces the previous 3-tab top nav.
 *
 * Why a picker instead of tabs: on a 360px phone viewport the horizontal
 * tab strip ate ~40% of the header before the user had declared intent.
 * Asking up front, with one tap to commit, is faster one-handed and
 * respects how people actually hold phones.
 *
 * Cards are intentionally 64px+ tall and full-width — thumb-reachable
 * without aiming, and WCAG 2.5.5 Large Target compliant. The prompt is
 * kept visually hidden (sr-only) because the card titles already declare
 * intent; screen readers still get the group labelling.
 */
export function IntentPicker({ onPick }: IntentPickerProps) {
  const { locale, config } = useKoe();
  const features = config.features ?? {};
  const picker = locale.picker ?? {
    prompt: "What's on your mind?",
    bug: 'Report a bug',
    bugHint: 'Something broken or confusing',
    feature: 'Suggest an idea',
    featureHint: 'New features, improvements',
    vote: 'Browse ideas',
    voteHint: 'Upvote requests from other users',
    myRequests: 'My requests',
    myRequestsHint: 'Follow the status of what you submitted',
  };

  const showBugs = features.bugs !== false;
  const showFeatures = features.features !== false;
  const showVote = features.vote !== false;
  // Only surface "my requests" when the host has identified a real user.
  // Anonymous sessions share a reporter id, so showing the tab would leak
  // tickets from other anonymous visitors into a shared inbox.
  const userId = config.user?.id;
  const showMyRequests = Boolean(userId && userId !== 'anonymous');

  return (
    <div className="koe-flex koe-flex-col koe-gap-3">
      <p id="koe-picker-prompt" className="koe-sr-only">
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
        {showVote && (
          <IntentCard
            emoji="⬆"
            title={picker.vote ?? 'Browse ideas'}
            hint={picker.voteHint ?? 'Upvote requests from other users'}
            onClick={() => onPick('vote')}
          />
        )}
        {showMyRequests && (
          <IntentCard
            emoji="📬"
            title={picker.myRequests ?? 'My requests'}
            hint={picker.myRequestsHint ?? 'Follow the status of what you submitted'}
            onClick={() => onPick('my-requests')}
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
