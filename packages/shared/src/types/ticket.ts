import type { WidgetUser } from './user';

export type TicketKind = 'bug' | 'feature';

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'planned'
  | 'resolved'
  | 'closed'
  | 'wont_fix';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Client-captured environment attached to a submission so support can
 * reproduce bugs without asking the reporter for details.
 */
export interface BrowserMetadata {
  userAgent: string;
  url: string;
  referrer?: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  language: string;
  timezone: string;
  devicePixelRatio: number;
  capturedAt: string;
}

export interface TicketBase {
  id: string;
  projectId: string;
  kind: TicketKind;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  reporter: WidgetUser;
  metadata?: BrowserMetadata;
  /** Data-URL or uploaded asset URL for a screenshot attached at report time. */
  screenshotUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BugReport extends TicketBase {
  kind: 'bug';
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
}

export interface FeatureRequest extends TicketBase {
  kind: 'feature';
  voteCount: number;
  /** User ids who have voted. */
  voters: string[];
}

export type Ticket = BugReport | FeatureRequest;

/** Payload sent by the widget when submitting a new bug report. */
export interface CreateBugReportInput {
  projectKey: string;
  title: string;
  description: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
  screenshotDataUrl?: string;
}

/** Payload sent by the widget when submitting a new feature request. */
export interface CreateFeatureRequestInput {
  projectKey: string;
  title: string;
  description: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
}
