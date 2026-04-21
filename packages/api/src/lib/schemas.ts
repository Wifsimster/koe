import { z } from 'zod';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@koe/shared';

/**
 * Centralised Zod schemas for every route handler. Keeps route files
 * focused on orchestration instead of inline validation declarations,
 * and makes it easy to grep for what the API accepts.
 */

/* -------------------------------------------------------------------------- */
/*  Shared primitives                                                         */
/* -------------------------------------------------------------------------- */

export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);

/* -------------------------------------------------------------------------- */
/*  Widget — public submission surface                                        */
/* -------------------------------------------------------------------------- */

export const reporterSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  avatarUrl: z
    .string()
    .url()
    .max(2048)
    // Block `javascript:` and `data:` scheme injection into the admin UI.
    .refine((u) => /^https?:\/\//i.test(u), 'avatarUrl must be http(s)')
    .optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const metadataSchema = z.object({
  userAgent: z.string().max(1024),
  url: z.string().max(2048),
  referrer: z.string().max(2048).optional(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  screen: z.object({ width: z.number(), height: z.number() }),
  language: z.string().max(32),
  timezone: z.string().max(64),
  devicePixelRatio: z.number(),
  capturedAt: z.string().max(64),
});

export const createBugSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  stepsToReproduce: z.string().max(10_000).optional(),
  expectedBehavior: z.string().max(10_000).optional(),
  actualBehavior: z.string().max(10_000).optional(),
  reporter: reporterSchema,
  metadata: metadataSchema,
  /**
   * Reference to a screenshot uploaded via presigned URL. The actual
   * upload never flows through this endpoint — that's what blew up
   * Postgres row sizes in the jsonb-blob design.
   */
  screenshotUrl: z.string().url().max(2048).optional(),
});

export const createFeatureSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  reporter: reporterSchema,
  metadata: metadataSchema,
});

export const voteSchema = z.object({
  userId: z.string().min(1).max(256),
});

export const myRequestsQuerySchema = z.object({
  userId: z.string().min(1).max(256),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* -------------------------------------------------------------------------- */
/*  Admin — project + ticket mutations                                        */
/* -------------------------------------------------------------------------- */

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'key must match /^[a-z0-9-]+$/'),
  allowedOrigins: z.array(z.string().trim().min(1).max(512)).max(20).optional(),
  requireIdentityVerification: z.boolean().optional(),
});

export const ticketQuerySchema = z.object({
  kind: z.enum(['bug', 'feature']).optional(),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  verified: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  sort: z.enum(['recent', 'votes']).default('recent').optional(),
});

/**
 * Partial ticket update — every field is optional, at least one is
 * required. `notes` is free-text admin-only scratch space; empty string
 * clears the field (normalised to null server-side).
 */
export const patchTicketSchema = z
  .object({
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    notes: z.string().max(10_000).nullable().optional(),
    isPublicRoadmap: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priority !== undefined ||
      v.notes !== undefined ||
      v.isPublicRoadmap !== undefined,
    { message: 'At least one of status, priority, notes, or isPublicRoadmap is required' },
  );

export const bulkPatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  patch: z
    .object({
      status: ticketStatusSchema.optional(),
      priority: ticketPrioritySchema.optional(),
    })
    .refine((v) => v.status !== undefined || v.priority !== undefined, {
      message: 'At least one of status or priority is required',
    }),
});

/* -------------------------------------------------------------------------- */
/*  Admin auth                                                                */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(4096),
});

/**
 * Optional override for the test-email endpoint. Empty body is valid
 * and means "send to whatever the env-resolved recipient is".
 */
export const testEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(320).optional(),
});
