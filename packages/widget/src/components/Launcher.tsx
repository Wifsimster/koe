import { useKoe } from '../context/KoeContext';

export interface LauncherProps {
  open: boolean;
  onToggle: () => void;
}

export function Launcher({ open, onToggle }: LauncherProps) {
  const { locale } = useKoe();
  return (
    <button
      type="button"
      aria-label={locale.launcherLabel}
      aria-expanded={open}
      onClick={onToggle}
      className="koe-flex koe-items-center koe-justify-center koe-w-12 koe-h-12 koe-shadow-koe koe-bg-koe-text koe-text-koe-bg hover:koe-bg-koe-text-hover koe-transition-colors"
    >
      {open ? <CloseIcon /> : <ChatIcon />}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
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
