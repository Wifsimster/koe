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
  redaction?: 'query-values';
  pageLoadedAt?: string;
  widgetVersion?: string;
  app?: { version?: string; release?: string };
  input?: { maxTouchPoints: number; coarsePointer: boolean; hover: boolean };
  breadcrumbs?: Breadcrumb[];
  console?: ConsoleEntry[];
  network?: NetworkEntry[];
}

export interface BreadcrumbTarget {
  tag: string;
  role?: string;
  name?: string;
  testId?: string;
}

export type Breadcrumb =
  | { ts: string; type: 'click'; target: BreadcrumbTarget }
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
  reporterVerified: boolean;
  metadata?: BrowserMetadata;
  screenshotUrl?: string;
  isPublicRoadmap: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MyRequestRow {
  id: string;
  kind: TicketKind;
  title: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  isPublicRoadmap: boolean;
  voteCount: number;
}

export interface PublicRoadmapRow {
  id: string;
  kind: TicketKind;
  title: string;
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
  voteCount: number;
  hasVoted: boolean;
}

export type Ticket = BugReport | FeatureRequest;

export interface CreateBugReportInput {
  title: string;
  description: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
  screenshotUrl?: string;
}

export interface CreateFeatureRequestInput {
  title: string;
  description: string;
  reporter: WidgetUser;
  metadata: BrowserMetadata;
}

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
  notes: string | null;
  isPublicRoadmap: boolean;
  createdAt: string;
  updatedAt: string;
  voteCount: number;
}
