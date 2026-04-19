import type { WidgetUser } from './user';

export const TICKET_KINDS = ['bug', 'feature'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'planned',
  'resolved',
  'closed',
  'wont_fix',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketKind(value: unknown): value is TicketKind {
  return typeof value === 'string' && (TICKET_KINDS as readonly string[]).includes(value);
}

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
  /**
   * Whether this ticket is published on the public roadmap at
   * `/r/:projectKey`. Toggled per ticket by an admin — default false.
   */
  isPublicRoadmap: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Row returned by `GET /v1/widget/my-requests`. Intentionally a thin
 * projection — no metadata, no screenshot, no reporter email — since
 * this is the shape the widget renders in a compact "my submissions"
 * list and we don't want to ship PII we don't need.
 */
export interface MyRequestRow {
  id: string;
  kind: TicketKind;
  title: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  isPublicRoadmap: boolean;
  /** Zero for bugs; derived via `count(*)` for features. */
  voteCount: number;
}

/**
 * Row returned by the public roadmap JSON endpoint
 * `GET /v1/public/:projectKey/roadmap`. Explicitly public — never
 * includes reporter identity, screenshots, or private metadata.
 */
export interface PublicRoadmapRow {
  id: string;
  kind: TicketKind;
  title: string;
  /** Truncated server-side to keep the public page concise. */
  description: string;
  status: Extract<TicketStatus, 'planned' | 'in_progress' | 'resolved'>;
  voteCount: number;
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

/**
 * Flat ticket row returned by the admin API (`GET /v1/admin/projects/:key/tickets`
 * and friends). Mirrors the database row layout rather than the nested
 * `TicketBase` shape because admin callers typically render each
 * reporter field in its own column.
 */
export interface AdminTicket {
  id: string;
  projectId: string;
  kind: TicketKind;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  reporterVerified: boolean;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  metadata: BrowserMetadata | null;
  screenshotUrl: string | null;
  /** Private admin notes. Never shown to the widget reporter. */
  notes: string | null;
  /** Whether this ticket appears on the public roadmap at `/r/:projectKey`. */
  isPublicRoadmap: boolean;
  createdAt: string;
  updatedAt: string;
  voteCount: number;
}
