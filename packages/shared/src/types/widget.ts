import type { WidgetUser } from './user';

export type WidgetPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface WidgetTheme {
  /** Hex color, e.g. "#4f46e5". Used for the launcher and primary buttons. */
  accentColor?: string;
  /** Force light/dark mode. Defaults to `auto` (follows prefers-color-scheme). */
  mode?: 'light' | 'dark' | 'auto';
  /** Border radius in px for the widget panel and launcher. */
  radius?: number;
}

export interface WidgetConfig {
  projectKey: string;
  user?: WidgetUser;
  /**
   * Opaque HMAC of `user.id` produced by your backend using the
   * project's identity secret (`hex(HMAC-SHA256(secret, user.id))`).
   *
   * @deprecated Prefer `identityToken`. Legacy v1 hashes have no TTL,
   * no nonce, and no rotation story — a captured hash is valid forever.
   * Existing integrations continue to work unchanged.
   */
  userHash?: string;
  /**
   * Signed identity token (v2) minted by your backend. Binds the
   * signature to `iat`, `nonce`, `projectId`, and `kid` so a captured
   * token cannot be replayed across sessions, projects, or forever, and
   * secrets can be rotated without breaking live integrations.
   * Required when the project has identity verification turned on
   * (takes precedence over `userHash` when both are set).
   */
  identityToken?: string;
  /** API base URL. Defaults to https://api.koe.dev */
  apiUrl?: string;
  position?: WidgetPosition;
  theme?: WidgetTheme;
  /** Features to enable. Defaults to all three. */
  features?: {
    bugs?: boolean;
    features?: boolean;
    chat?: boolean;
  };
  /** Localization strings. */
  locale?: Partial<WidgetLocale>;
}

export interface WidgetLocale {
  launcherLabel: string;
  title: string;
  subtitle: string;
  /**
   * Labels for the intent picker — the first screen of the widget.
   * Optional for backward compatibility with locales authored before
   * the picker shipped; English fallbacks kick in when a key is missing.
   */
  picker?: {
    prompt: string;
    bug: string;
    bugHint: string;
    feature: string;
    featureHint: string;
  };
  /** Label for the back button that returns to the intent picker. */
  back?: string;
  /**
   * Legacy top-tab labels. Retained for type stability; no longer
   * rendered since the widget switched to an intent-picker flow.
   * @deprecated Use `picker` instead.
   */
  tabs: {
    bug: string;
    feature: string;
    chat: string;
  };
  bugForm: {
    title: string;
    description: string;
    steps: string;
    expected: string;
    actual: string;
    /** Label for the optional email field shown above submit. */
    email?: string;
    submit: string;
    success: string;
  };
  featureForm: {
    title: string;
    description: string;
    /** Label for the optional email field shown above submit. */
    email?: string;
    submit: string;
    success: string;
  };
  /**
   * Chat strings retained for forward compatibility. The chat tab is
   * not currently rendered — a real conversation backend is wired in a
   * later MR.
   */
  chat: {
    placeholder: string;
    empty: string;
    send: string;
  };
  /** Inline error messages surfaced by the widget forms. */
  errors: {
    required: string;
    invalidEmail: string;
    network: string;
    generic: string;
  };
}

export const DEFAULT_LOCALE: WidgetLocale = {
  launcherLabel: 'Support',
  title: 'How can we help?',
  subtitle: 'Report a bug or suggest an idea — your feedback goes straight to the team.',
  picker: {
    prompt: "What's on your mind?",
    bug: 'Report a bug',
    bugHint: 'Something broken or confusing',
    feature: 'Suggest an idea',
    featureHint: 'New features, improvements',
  },
  back: 'Back',
  tabs: {
    bug: 'Bug',
    feature: 'Feature',
    chat: 'Chat',
  },
  bugForm: {
    title: 'Title',
    description: 'What happened?',
    steps: 'Steps to reproduce',
    expected: 'Expected behavior',
    actual: 'Actual behavior',
    email: 'Email (optional — so we can follow up)',
    submit: 'Send bug report',
    success: 'Thanks — your report has been received.',
  },
  featureForm: {
    title: 'Title',
    description: 'Describe your idea',
    email: 'Email (optional — so we can follow up)',
    submit: 'Submit request',
    success: 'Thanks for the suggestion!',
  },
  chat: {
    placeholder: 'Type a message…',
    empty: 'No messages yet. Say hi!',
    send: 'Send',
  },
  errors: {
    required: 'Required',
    invalidEmail: 'Enter a valid email',
    network: 'Network error — check your connection',
    generic: 'Something went wrong',
  },
};
