import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db/index.js';
import { createRawSessionToken, hashSessionToken } from '../middleware/adminAuth.js';

/**
 * Creates (or reuses) an admin user by email, optionally grants them a
 * role on a project, and mints a session token. Prints the raw token
 * to stdout — that value is only shown once and cannot be re-derived
 * from the DB (only the SHA-256 hash is stored).
 *
 * Usage:
 *   pnpm --filter @koe/api exec tsx src/bin/admin-session.ts \
 *     --email you@example.com --project-key acme --role owner --ttl-days 30
 *
 * Production refuses to run when `ADMIN_AUTH_MODE=oidc` is the only
 * allowed mode — the OIDC provider is the source of truth there.
 */

type Args = {
  email: string;
  displayName?: string;
  projectKey?: string;
  role?: 'owner' | 'member' | 'viewer';
  ttlDays: number;
};

function parse(): Args {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'display-name': { type: 'string' },
      'project-key': { type: 'string' },
      role: { type: 'string' },
      'ttl-days': { type: 'string', default: '30' },
    },
  });

  if (!values.email) {
    throw new Error('--email is required');
  }
  const ttl = Number(values['ttl-days']);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('--ttl-days must be a positive number');
  }
  const role = values.role as Args['role'] | undefined;
  if (role && !['owner', 'member', 'viewer'].includes(role)) {
    throw new Error('--role must be one of: owner, member, viewer');
  }

  return {
    email: values.email,
    displayName: values['display-name'],
    projectKey: values['project-key'],
    role,
    ttlDays: ttl,
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_AUTH_MODE !== 'dev-session') {
    throw new Error(
      'admin-session CLI refuses to run in production unless ADMIN_AUTH_MODE=dev-session. ' +
        'Use your OIDC provider to onboard real users.',
    );
  }
  if (!dbAvailable) {
    throw new Error('DATABASE_URL must be set');
  }

  // Caller is responsible for running migrations first (the drizzle
  // workflow is explicit in Koe — see `pnpm --filter @koe/api db:migrate`).
  const args = parse();

  // Upsert the admin user by email. Using two statements instead of
  // ON CONFLICT ... RETURNING because drizzle's onConflictDoUpdate
  // on a partial-unique column is verbose — two queries on a rare
  // CLI invocation is fine.
  const [existing] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, args.email))
    .limit(1);

  const user =
    existing ??
    (
      await db
        .insert(schema.adminUsers)
        .values({ email: args.email, displayName: args.displayName ?? null })
        .returning()
    )[0]!;

  if (args.projectKey) {
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.key, args.projectKey))
      .limit(1);
    if (!project) {
      throw new Error(`Project with key "${args.projectKey}" not found`);
    }

    await db
      .insert(schema.projectMembers)
      .values({
        projectId: project.id,
        userId: user.id,
        role: args.role ?? 'owner',
      })
      .onConflictDoNothing();
  }

  const rawToken = createRawSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + args.ttlDays * 24 * 60 * 60 * 1000);

  await db.insert(schema.adminSessions).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  console.log('');
  console.log('Admin session created:');
  console.log(`  user:      ${user.email} (${user.id})`);
  if (args.projectKey) {
    console.log(`  project:   ${args.projectKey}  role=${args.role ?? 'owner'}`);
  }
  console.log(`  expires:   ${expiresAt.toISOString()}`);
  console.log(`  token:     ${rawToken}`);
  console.log('');
  console.log('Use with: Authorization: Bearer ' + rawToken);
  console.log('This token is shown once — the server stores only its SHA-256 hash.');
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error('[koe/api] admin-session failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
