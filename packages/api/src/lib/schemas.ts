import { z } from 'zod';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@koe/shared';


export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);

export const reporterSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  avatarUrl: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), 'avatarUrl must be http(s)')
    .optional(),
  metadata: z
    .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .refine((m) => Object.keys(m).length <= 20, 'reporter.metadata accepts at most 20 keys')
    .optional(),
});

export const MAX_CAPTURED_ENTRIES = 50;

const breadcrumbTargetSchema = z.object({
  tag: z.string().max(32),
  role: z.string().max(32).optional(),
  name: z.string().max(200).optional(),
  testId: z.string().max(100).optional(),
});

const breadcrumbSchema = z.discriminatedUnion('type', [
  z.object({ ts: z.string().max(64), type: z.literal('click'), target: breadcrumbTargetSchema }),
  z.object({ ts: z.string().max(64), type: z.literal('input'), target: breadcrumbTargetSchema }),
  z.object({ ts: z.string().max(64), type: z.literal('navigation'), url: z.string().max(2048) }),
]);

const consoleEntrySchema = z.object({
  ts: z.string().max(64),
  level: z.enum(['error', 'warn']),
  message: z.string().max(1000),
});

const networkEntrySchema = z.object({
  ts: z.string().max(64),
  method: z.string().max(16),
  url: z.string().max(2048),
  status: z.number().int().min(0).max(999),
  durationMs: z.number().min(0).max(3_600_000),
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
  redaction: z.literal('query-values').optional(),
  pageLoadedAt: z.string().max(64).optional(),
  widgetVersion: z.string().max(64).optional(),
  app: z
    .object({ version: z.string().max(64).optional(), release: z.string().max(128).optional() })
    .optional(),
  input: z
    .object({
      maxTouchPoints: z.number().int().min(0).max(256),
      coarsePointer: z.boolean(),
      hover: z.boolean(),
    })
    .optional(),
  breadcrumbs: z.array(breadcrumbSchema).max(MAX_CAPTURED_ENTRIES).optional(),
  console: z.array(consoleEntrySchema).max(MAX_CAPTURED_ENTRIES).optional(),
  network: z.array(networkEntrySchema).max(MAX_CAPTURED_ENTRIES).optional(),
});

export const createBugSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  stepsToReproduce: z.string().max(10_000).optional(),
  expectedBehavior: z.string().max(10_000).optional(),
  actualBehavior: z.string().max(10_000).optional(),
  reporter: reporterSchema,
  metadata: metadataSchema,
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

export const allowedOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (v) => v !== '*',
    'wildcard "*" is not allowed; leave allowedOrigins empty for permissive',
  )
  .refine((v) => !/^file:\/\//i.test(v), 'file:// origins are not allowed')
  .superRefine((v, ctx) => {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid origin URL like https://example.com',
      });
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'origin scheme must be http or https',
      });
      return;
    }
    if (url.username || url.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'origin must not include credentials',
      });
      return;
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'origin must not include a path, query, or fragment',
      });
      return;
    }
    if (v.endsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'origin must not have a trailing slash',
      });
      return;
    }
  });

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'key must match /^[a-z0-9-]+$/'),
  allowedOrigins: z.array(allowedOriginSchema).max(20).optional(),
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

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(4096),
});

export const testEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(320).optional(),
});
