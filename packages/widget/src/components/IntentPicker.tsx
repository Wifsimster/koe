import clsx from 'clsx';
import { useKoe } from '../context/KoeContext';
import { Icon, type IconName } from './ui/Icon';

export type Intent = 'bug' | 'feature' | 'vote' | 'my-requests';

export interface IntentPickerProps {
  onPick: (intent: Intent) => void;
}

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
  const userId = config.user?.id;
  const showMyRequests = Boolean(userId && userId !== 'anonymous');

  return (
    <div className="koe-flex koe-flex-col koe-gap-3">
      <p id="koe-picker-prompt" className="koe-sr-only">
        {picker.prompt}
      </p>
      <fieldset aria-labelledby="koe-picker-prompt" className="koe-flex koe-flex-col koe-gap-2">
        {showBugs && (
          <IntentCard
            icon="bug"
            title={picker.bug}
            hint={picker.bugHint}
            onClick={() => onPick('bug')}
          />
        )}
        {showFeatures && (
          <IntentCard
            icon="lightbulb"
            title={picker.feature}
            hint={picker.featureHint}
            onClick={() => onPick('feature')}
          />
        )}
        {showVote && (
          <IntentCard
            icon="arrow-up"
            title={picker.vote ?? 'Browse ideas'}
            hint={picker.voteHint ?? 'Upvote requests from other users'}
            onClick={() => onPick('vote')}
          />
        )}
        {showMyRequests && (
          <IntentCard
            icon="inbox"
            title={picker.myRequests ?? 'My requests'}
            hint={picker.myRequestsHint ?? 'Follow the status of what you submitted'}
            onClick={() => onPick('my-requests')}
          />
        )}
      </fieldset>
    </div>
  );
}

interface IntentCardProps {
  icon: IconName;
  title: string;
  hint: string;
  onClick: () => void;
}

function IntentCard({ icon, title, hint, onClick }: IntentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'koe-flex koe-items-center koe-gap-3 koe-w-full koe-text-left',
        'koe-min-h-[64px] koe-px-4 koe-py-3',
        'koe-rounded-koe koe-border koe-border-koe-border koe-bg-koe-bg',
        'hover:koe-border-koe-text focus:koe-outline-none focus-visible:koe-border-koe-accent',
        'koe-transition-colors',
      )}
    >
      <span className="koe-flex koe-shrink-0 koe-text-koe-text">
        <Icon name={icon} size={22} />
      </span>
      <span className="koe-flex koe-flex-col koe-min-w-0">
        <span className="koe-text-sm koe-font-medium koe-text-koe-text koe-truncate">{title}</span>
        <span className="koe-text-[11px] koe-text-koe-text-muted koe-truncate">{hint}</span>
      </span>
    </button>
  );
}
