import type { TicketKind, TicketStatus } from '@koe/shared';

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
