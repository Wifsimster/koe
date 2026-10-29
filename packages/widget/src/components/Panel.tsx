import { useEffect, useRef, useState } from 'react';
import { useKoe } from '../context/KoeContext';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { BugReportForm } from './forms/BugReportForm';
import { FeatureRequestForm } from './forms/FeatureRequestForm';
import { IntentPicker, type Intent } from './IntentPicker';
import { BrowseList } from './BrowseList';
import { MyRequestsList } from './MyRequestsList';

export interface PanelProps {
  onClose: () => void;
}

export function Panel({ onClose }: PanelProps) {
  const { locale, config } = useKoe();
  const features = config.features ?? { bugs: true, features: true };

  const initialIntent = soloEnabledIntent(features);
  const [screen, setScreen] = useState<Intent | null>(initialIntent);

  const userId = config.user?.id;
  const canSeeMyRequests = Boolean(userId && userId !== 'anonymous');
  const goToMyRequests = canSeeMyRequests ? () => setScreen('my-requests') : undefined;

  const shellRef = useRef<HTMLDialogElement>(null);
  useVisualViewport(shellRef);

  const lastFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as
      | HTMLElement
      | null;
    lastFocusRef.current = previouslyFocused;
    return () => {
      const el = lastFocusRef.current;
      if (el && typeof el.focus === 'function' && el.isConnected) {
        el.focus();
      }
    };
  }, []);

  const back = locale.back ?? 'Back';

  return (
    <dialog
      ref={shellRef}
      open
      aria-labelledby="koe-panel-title"
      className="koe-panel-shell koe-mb-3 koe-rounded-koe koe-bg-koe-bg koe-text-koe-text koe-shadow-koe koe-border koe-border-koe-border"
    >
      <div aria-hidden="true" className="koe-panel-grab" />

      <header className="koe-panel-header koe-px-4 koe-py-3 koe-border-b koe-border-koe-border">
        <div className="koe-flex koe-items-start koe-justify-between koe-gap-2">
          <div className="koe-flex koe-items-center koe-gap-2 koe-min-w-0">
            {screen !== null && (
              <button
                type="button"
                onClick={() => setScreen(null)}
                aria-label={back}
                className="koe-inline-flex koe-items-center koe-justify-center koe-min-h-[44px] koe-min-w-[44px] koe-text-koe-text-muted hover:koe-text-koe-text koe-shrink-0 -koe-ml-2"
              >
                <BackIcon />
              </button>
            )}
            <div className="koe-min-w-0">
              <h2
                id="koe-panel-title"
                className="koe-m-0 koe-text-[10px] koe-tracking-[0.18em] koe-uppercase koe-text-koe-text-muted"
              >
                {headerTitle(screen, locale)}
              </h2>
              <p className="koe-text-[13px] koe-text-koe-text koe-mt-1 koe-m-0 koe-truncate">
                {locale.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="koe-inline-flex koe-items-center koe-justify-center koe-min-h-[44px] koe-min-w-[44px] koe-text-koe-text-muted hover:koe-text-koe-text koe-shrink-0 -koe-mr-2"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="koe-panel-body koe-p-4">
        {screen === null && <IntentPicker onPick={setScreen} />}
        {screen === 'bug' && <BugReportForm onViewMyRequests={goToMyRequests} />}
        {screen === 'feature' && <FeatureRequestForm onViewMyRequests={goToMyRequests} />}
        {screen === 'vote' && <BrowseList />}
        {screen === 'my-requests' && <MyRequestsList />}
      </div>
    </dialog>
  );
}

function soloEnabledIntent(features: { bugs?: boolean; features?: boolean; vote?: boolean }): Intent | null {
  const enabled: Intent[] = [];
  if (features.bugs !== false) enabled.push('bug');
  if (features.features !== false) enabled.push('feature');
  if (features.vote !== false) enabled.push('vote');
  return enabled.length === 1 ? enabled[0] ?? null : null;
}

function headerTitle(screen: Intent | null, locale: ReturnType<typeof useKoe>['locale']): string {
  if (screen === 'bug') return locale.picker?.bug ?? 'Report a bug';
  if (screen === 'feature') return locale.picker?.feature ?? 'Suggest an idea';
  if (screen === 'vote') return locale.browse?.title ?? 'Ideas';
  if (screen === 'my-requests') return locale.myRequests?.title ?? 'My requests';
  return locale.title;
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
