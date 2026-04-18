import { useRef, useState } from 'react';
import { useKoe } from '../context/KoeContext';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { BugReportForm } from './forms/BugReportForm';
import { FeatureRequestForm } from './forms/FeatureRequestForm';
import { IntentPicker, type Intent } from './IntentPicker';

export interface PanelProps {
  onClose: () => void;
}

/**
 * The widget's main surface. Two screens:
 *
 *   1. `picker` — intent selection (bug / feature). Entry point.
 *   2. `form`   — the selected form, with a back button.
 *
 * On narrow viewports (<480px) the shell flips to a bottom-sheet posture
 * — see `styles.css` for the `@media` rule. Same component, no fork.
 *
 * The root element has `container-type: inline-size` so later refactors
 * (Shadow DOM, sized iframe embeds) can switch the same rules over to
 * `@container` without touching JS.
 */
export function Panel({ onClose }: PanelProps) {
  const { locale, config } = useKoe();
  const features = config.features ?? { bugs: true, features: true };

  const initialIntent: Intent | null =
    features.bugs === false && features.features !== false ? 'feature' : null;
  const [screen, setScreen] = useState<Intent | null>(initialIntent);

  // Track visual viewport so the panel body follows the keyboard on
  // mobile. Writes a CSS variable; no React re-render per resize.
  const shellRef = useRef<HTMLDivElement>(null);
  useVisualViewport(shellRef.current);

  const back = locale.back ?? 'Back';

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="koe-panel-title"
      className="koe-panel-shell koe-mb-3 koe-bg-koe-bg koe-text-koe-text koe-shadow-koe koe-border koe-border-koe-border"
    >
      {/* Grab handle, only visible in bottom-sheet mode (CSS-controlled). */}
      <div aria-hidden="true" className="koe-panel-grab" />

      <header className="koe-panel-header koe-px-4 koe-py-3 koe-border-b koe-border-koe-border">
        <div className="koe-flex koe-items-start koe-justify-between koe-gap-2">
          <div className="koe-flex koe-items-center koe-gap-2 koe-min-w-0">
            {screen !== null && (
              <button
                type="button"
                onClick={() => setScreen(null)}
                aria-label={back}
                // 44px hit target, visible chevron only.
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
            // 44px hit target fixes the previous 24px ✕ fat-finger hazard.
            className="koe-inline-flex koe-items-center koe-justify-center koe-min-h-[44px] koe-min-w-[44px] koe-text-koe-text-muted hover:koe-text-koe-text koe-shrink-0 -koe-mr-2"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="koe-panel-body koe-p-4">
        {screen === null && <IntentPicker onPick={setScreen} />}
        {screen === 'bug' && <BugReportForm />}
        {screen === 'feature' && <FeatureRequestForm />}
      </div>
    </div>
  );
}

function headerTitle(screen: Intent | null, locale: ReturnType<typeof useKoe>['locale']): string {
  if (screen === 'bug') return locale.picker?.bug ?? 'Report a bug';
  if (screen === 'feature') return locale.picker?.feature ?? 'Suggest an idea';
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
