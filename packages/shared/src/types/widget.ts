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
    submit: string;
    success: string;
  };
  featureForm: {
    title: string;
    description: string;
    submit: string;
    success: string;
  };
  chat: {
    placeholder: string;
    empty: string;
    send: string;
  };
}

export const DEFAULT_LOCALE: WidgetLocale = {
  launcherLabel: 'Support',
  title: 'How can we help?',
  subtitle: "Report a bug, request a feature, or chat with us.",
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
    submit: 'Send bug report',
    success: 'Thanks — your report has been received.',
  },
  featureForm: {
    title: 'Title',
    description: 'Describe your idea',
    submit: 'Submit request',
    success: 'Thanks for the suggestion!',
  },
  chat: {
    placeholder: 'Type a message…',
    empty: 'No messages yet. Say hi!',
    send: 'Send',
  },
};
