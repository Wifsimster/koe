import type { WidgetUser } from './user';

export type WidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface WidgetTheme {
  accentColor?: string;
  mode?: 'light' | 'dark' | 'auto';
  radius?: number;
}

export interface WidgetConfig {
  projectKey: string;
  user?: WidgetUser;
  /** @deprecated Prefer `identityToken`. Legacy v1 hashes have no TTL, no nonce, and no rotation story — a captured hash is valid forever. Existing integrations continue to work unchanged. */
  userHash?: string;
  identityToken?: string;
  apiUrl: string;
  position?: WidgetPosition;
  theme?: WidgetTheme;
  features?: {
    bugs?: boolean;
    features?: boolean;
    chat?: boolean;
    vote?: boolean;
  };
  language?: string;
  locale?: Partial<WidgetLocale>;
  app?: { version?: string; release?: string };
  capture?: {
    keepQueryParams?: string[];
    trail?: boolean;
  };
  captureScreenshot?: () => Promise<string | undefined>;
}

export interface WidgetLocale {
  launcherLabel: string;
  title: string;
  subtitle: string;
  picker?: {
    prompt: string;
    bug: string;
    bugHint: string;
    feature: string;
    featureHint: string;
    vote?: string;
    voteHint?: string;
    myRequests?: string;
    myRequestsHint?: string;
  };
  browse?: {
    title: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    voteAriaLabel: string;
    unvoteAriaLabel: string;
    signInToVote: string;
  };
  myRequests?: {
    title: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    viewOnRoadmap: string;
    status: {
      open: string;
      in_progress: string;
      planned: string;
      resolved: string;
      closed: string;
      wont_fix: string;
    };
  };
  back?: string;
  /** @deprecated Use `picker` instead. */
  tabs: {
    bug: string;
    feature: string;
    chat: string;
  };
  bugForm: {
    title: string;
    description: string;
    reproduce: string;
    /** @deprecated Merged into `reproduce`. Retained so locales authored before the consolidation still typecheck; no longer rendered. */
    steps?: string;
    expected?: string;
    /** @deprecated Not rendered: "What happened?" (`description`) is the actual behavior. */
    actual?: string;
    email?: string;
    submit: string;
    success: string;
  };
  featureForm: {
    title: string;
    description: string;
    email?: string;
    submit: string;
    success: string;
  };
  chat: {
    placeholder: string;
    empty: string;
    send: string;
  };
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
    myRequests: 'My requests',
    myRequestsHint: 'Follow the status of what you submitted',
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
  myRequests: {
    title: 'My requests',
    loading: 'Loading your requests…',
    empty: "You haven't submitted anything yet.",
    error: "Couldn't load your requests.",
    retry: 'Try again',
    viewOnRoadmap: 'View on roadmap',
    status: {
      open: 'Open',
      in_progress: 'In progress',
      planned: 'Planned',
      resolved: 'Shipped',
      closed: 'Closed',
      wont_fix: "Won't fix",
    },
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
    expected: 'What did you expect?',
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
