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
  /** True when the reporter's identity was HMAC-verified at submission. */
  reporterVerified: boolean;
  metadata?: BrowserMetadata;
  /**
   * URL to a screenshot stored on object storage (e.g. S3/R2 presigned
   * upload). Never a base64 data URL — those are rejected at the API.
   */
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
  /** Derived via `count(*)` on `ticket_votes` — no denormalized counter. */
  voteCount: number;
  /** Whether the current viewer has already voted (server-evaluated). */
  hasVoted: boolean;
}

export type Ticket = BugReport | FeatureRequest;

/** Payload sent by the widget when submitting a new bug report. */
export interface CreateBugReportInput {
  title: string;
  description: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
  /** Pre-uploaded screenshot URL — the widget never ships base64 inline. */
  screenshotUrl?: string;
}

/** Payload sent by the widget when submitting a new feature request. */
export interface CreateFeatureRequestInput {
  title: string;
  description: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
}
