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
  /** Page URL. Query and hash values are redacted (see `redactUrl`). */
  url: string;
  referrer?: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  language: string;
  timezone: string;
  devicePixelRatio: number;
  capturedAt: string;
  /**
   * Set by widgets that already redacted URLs client-side
   * (`'query-values'`). The API redacts every query value of reports
   * without it, so older widgets do not leak tokens either.
   */
  redaction?: 'query-values';
  /** When the host page started loading (`performance.timeOrigin`). */
  pageLoadedAt?: string;
  /** Widget build that captured the report, e.g. `v1.9.0-3-g54e50cb`. */
  widgetVersion?: string;
  /** Host app context passed through `WidgetConfig.app`. */
  app?: { version?: string; release?: string };
  /** Input capability, so a replay can emulate touch. */
  input?: { maxTouchPoints: number; coarsePointer: boolean; hover: boolean };
  /** Last user actions before the report, oldest first. Never field contents. */
  breadcrumbs?: Breadcrumb[];
  /** Last console errors and warnings, oldest first. */
  console?: ConsoleEntry[];
  /** Last failed or 4xx/5xx requests, oldest first. URLs redacted. */
  network?: NetworkEntry[];
}

/** Accessible description of the element an action targeted. */
export interface BreadcrumbTarget {
  tag: string;
  role?: string;
  /** Accessible name, truncated. Empty for fields: their content is never read. */
  name?: string;
  /** `data-testid`, when the host sets one. */
  testId?: string;
}

export type Breadcrumb =
  | { ts: string; type: 'click'; target: BreadcrumbTarget }
  /** A field was edited. Records which field, never what was typed. */
  | { ts: string; type: 'input'; target: BreadcrumbTarget }
  | { ts: string; type: 'navigation'; url: string };

export interface ConsoleEntry {
  ts: string;
  level: 'error' | 'warn';
  message: string;
}

export interface NetworkEntry {
  ts: string;
  method: string;
  url: string;
  /** HTTP status, or 0 when the request failed without a response. */
  status: number;
  durationMs: number;
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
