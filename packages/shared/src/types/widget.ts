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
    /**
     * When true, surfaces a "browse & vote on ideas" screen alongside
     * the submission forms. Defaults to true. The vote action itself
     * additionally requires the host to pass an identified user — the
     * browse list still renders for anonymous visitors in read-only
     * mode so they aren't blocked from seeing existing requests.
     */
    vote?: boolean;
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
    vote?: string;
    voteHint?: string;
  };
  /** Strings for the browse-and-vote screen. */
  browse?: {
    title: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    voteAriaLabel: string;
    unvoteAriaLabel: string;
    /** Shown inline when the host hasn't identified the reporter. */
    signInToVote: string;
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
    /**
     * Single optional "how to reproduce" textarea. Replaces the earlier
     * triplet (steps / expected / actual) — most reporters pasted a free
     * form repro into one field anyway.
     */
    reproduce: string;
    /**
     * @deprecated Merged into `reproduce`. Retained so locales authored
     * before the consolidation still typecheck; no longer rendered.
     */
    steps?: string;
    /** @deprecated Merged into `reproduce`. */
    expected?: string;
    /** @deprecated Merged into `reproduce`. */
    actual?: string;
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
  subtitle: 'We read every message.',
  picker: {
    prompt: "What's on your mind?",
    bug: 'Report a bug',
    bugHint: 'Something broken or confusing',
    feature: 'Suggest an idea',
    featureHint: 'New features, improvements',
    vote: 'Browse ideas',
    voteHint: 'Upvote requests from other users',
  },
  browse: {
    title: 'Ideas',
    loading: 'Loading ideas…',
    empty: 'No ideas yet — be the first to suggest one.',
    error: "Couldn't load ideas.",
    retry: 'Try again',
    voteAriaLabel: 'Upvote',
    unvoteAriaLabel: 'Remove upvote',
    signInToVote: 'Sign in to vote',
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
    reproduce: 'How to reproduce',
    email: 'Email · optional',
    submit: 'Send bug report',
    success: 'Thanks — your report has been received.',
  },
  featureForm: {
    title: 'Title',
    description: 'Describe your idea',
    email: 'Email · optional',
    submit: 'Submit request',
    success: 'Thanks for the suggestion!',
  },
  chat: {
    placeholder: 'Type a message…',
    empty: 'No messages yet. Say hi!',
    send: 'Send',
  },
  errors: {
    required: 'Please fill this out',
    invalidEmail: 'Enter a valid email',
    network: 'Network error — check your connection',
    generic: 'Something went wrong',
  },
};
