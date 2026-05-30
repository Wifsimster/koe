import type { TicketKind, TicketStatus } from '@koe/shared';

/**
 * Route search-param shapes and defaults, kept in a dependency-free
 * module so pages and the shell can import them without pulling in
 * `router.tsx` (which imports those same pages — the import cycle that
 * extracting these constants breaks).
 */

export interface LoginSearch {
  redirectTo?: string;
}

export interface InboxSearch {
  kind: TicketKind | 'all';
  status: TicketStatus | 'all';
  q: string;
  sort: 'recent' | 'votes';
}

export const INBOX_DEFAULT_SEARCH: InboxSearch = {
  kind: 'all',
  status: 'open',
  q: '',
  sort: 'recent',
};
