import './styles.css';

export { KoeWidget } from './components/KoeWidget';
export { KoeProvider, useKoe } from './context/KoeContext';
export { init, destroy } from './standalone';
export type {
  WidgetConfig,
  WidgetPosition,
  WidgetTheme,
  WidgetLocale,
  WidgetLanguage,
  WidgetUser,
  BugReport,
  FeatureRequest,
  Ticket,
  TicketKind,
  TicketStatus,
} from '@koe/shared';
export { LOCALES, resolveLocale, detectBrowserLanguage } from '@koe/shared';
