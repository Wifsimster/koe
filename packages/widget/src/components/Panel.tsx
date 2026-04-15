import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useKoe } from '../context/KoeContext';
import { BugReportForm } from './forms/BugReportForm';
import { FeatureRequestForm } from './forms/FeatureRequestForm';
import { ChatPanel } from './chat/ChatPanel';

type TabId = 'bug' | 'feature' | 'chat';

export interface PanelProps {
  onClose: () => void;
}

export function Panel({ onClose }: PanelProps) {
  const { locale, config } = useKoe();
  const features = config.features ?? { bugs: true, features: true, chat: true };

  const firstTab: TabId =
    features.bugs !== false ? 'bug' : features.features !== false ? 'feature' : 'chat';
  const [tab, setTab] = useState<TabId>(firstTab);

  return (
    <div
      role="dialog"
      aria-labelledby="koe-panel-title"
      className="koe-mb-3 koe-w-[360px] koe-max-w-[calc(100vw-2rem)] koe-bg-koe-bg koe-text-koe-text koe-rounded-xl koe-shadow-koe koe-border koe-border-koe-border koe-overflow-hidden"
      style={{ borderRadius: 'var(--koe-radius, 12px)' }}
    >
      <header className="koe-p-4 koe-bg-koe-accent koe-text-white">
        <div className="koe-flex koe-items-start koe-justify-between">
          <div>
            <h2 id="koe-panel-title" className="koe-text-base koe-font-semibold koe-m-0">
              {locale.title}
            </h2>
            <p className="koe-text-xs koe-opacity-90 koe-mt-1 koe-m-0">{locale.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="koe-text-white koe-opacity-80 hover:koe-opacity-100"
          >
            ✕
          </button>
        </div>
      </header>

      <nav className="koe-flex koe-border-b koe-border-koe-border koe-bg-koe-bg-muted">
        {features.bugs !== false && (
          <TabButton active={tab === 'bug'} onClick={() => setTab('bug')}>
            {locale.tabs.bug}
          </TabButton>
        )}
        {features.features !== false && (
          <TabButton active={tab === 'feature'} onClick={() => setTab('feature')}>
            {locale.tabs.feature}
          </TabButton>
        )}
        {features.chat !== false && (
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
            {locale.tabs.chat}
          </TabButton>
        )}
      </nav>

      <div className="koe-p-4 koe-max-h-[60vh] koe-overflow-y-auto">
        {tab === 'bug' && <BugReportForm />}
        {tab === 'feature' && <FeatureRequestForm />}
        {tab === 'chat' && <ChatPanel />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={clsx(
        'koe-flex-1 koe-py-3 koe-text-sm koe-font-medium koe-transition-colors',
        active
          ? 'koe-text-koe-accent koe-border-b-2 koe-border-koe-accent'
          : 'koe-text-koe-text-muted hover:koe-text-koe-text',
      )}
    >
      {children}
    </button>
  );
}
