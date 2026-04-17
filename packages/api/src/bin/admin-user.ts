import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db/index.js';
import { hashPassword } from '../lib/password.js';

/**
 * Seeds or resets an admin user for `ADMIN_AUTH_MODE=password`.
 *
 * Creates the `admin_users` row if missing and sets its argon2id
 * `password_hash`. Optionally grants membership on a project.
 *
 * Usage (interactive prompt for the password):
 *   docker compose run --rm api dist/admin-user.js \
 *     --email you@example.com --project-key acme --role owner
 *
 * Usage (non-interactive, piped password):
 *   docker compose run --rm -e KOE_ADMIN_PASSWORD='hunter2' api \
 *     dist/admin-user.js --email you@example.com --non-interactive
 *
 * Interactive is the default since the interactive path refuses weak
 * passwords twice and confirms; `--non-interactive` trusts the env var.
 */

type Args = {
  email: string;
  displayName?: string;
  projectKey?: string;
  role?: 'owner' | 'member' | 'viewer';
  nonInteractive: boolean;
};

function parse(): Args {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'display-name': { type: 'string' },
      'project-key': { type: 'string' },
      role: { type: 'string' },
      'non-interactive': { type: 'boolean', default: false },
    },
  });

  if (!values.email) {
    throw new Error('--email is required');
  }
  const role = values.role as Args['role'] | undefined;
  if (role && !['owner', 'member', 'viewer'].includes(role)) {
    throw new Error('--role must be one of: owner, member, viewer');
  }

  return {
    email: values.email.trim().toLowerCase(),
    displayName: values['display-name'],
    projectKey: values['project-key'],
    role,
    nonInteractive: Boolean(values['non-interactive']),
  };
}

/**
 * Resolve the password. Reads `KOE_ADMIN_PASSWORD` when set — that path
 * is the one Docker / CI uses. Otherwise prompts twice on stdin so a
 * typo can't silently lock the account. Refuses a password shorter
 * than 12 chars — low bar, but blocks the "password" classic.
 */
async function readPassword(nonInteractive: boolean): Promise<string> {
  const fromEnv = process.env.KOE_ADMIN_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < 12) {
      throw new Error('KOE_ADMIN_PASSWORD must be at least 12 characters');
    }
    return fromEnv;
  }
  if (nonInteractive) {
    throw new Error(
      '--non-interactive requires KOE_ADMIN_PASSWORD in the environment',
    );
  }

  const rl = createInterface({ input, output });
  try {
    const first = await rl.question('New password (min 12 chars): ');
    if (first.length < 12) {
      throw new Error('Password must be at least 12 characters');
    }
    const second = await rl.question('Confirm password: ');
    if (first !== second) {
      throw new Error('Passwords do not match');
    }
    return first;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  if (!dbAvailable) {
    throw new Error('DATABASE_URL must be set');
  }

  const args = parse();
  const password = await readPassword(args.nonInteractive);
  const passwordHash = await hashPassword(password);

  // Upsert by email. Two statements rather than ON CONFLICT to keep
  // the code obvious — this is a one-off CLI, not a hot path.
  const [existing] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, args.email))
    .limit(1);

  let userId: string;
  if (existing) {
    await db
      .update(schema.adminUsers)
      .set({
        passwordHash,
        ...(args.displayName ? { displayName: args.displayName } : {}),
      })
      .where(eq(schema.adminUsers.id, existing.id));
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(schema.adminUsers)
      .values({
        email: args.email,
        displayName: args.displayName ?? null,
        passwordHash,
      })
      .returning();
    if (!created) throw new Error('Failed to insert admin user');
    userId = created.id;
  }

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
        userId,
        role: args.role ?? 'owner',
      })
      .onConflictDoNothing();
  }

  console.log('');
  console.log(existing ? 'Admin password updated:' : 'Admin user created:');
  console.log(`  email:     ${args.email}`);
  console.log(`  id:        ${userId}`);
  if (args.projectKey) {
    console.log(`  project:   ${args.projectKey}  role=${args.role ?? 'owner'}`);
  }
  console.log('');
  console.log('Sign in at /admin/ with this email and the password you just set.');
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error('[koe/api] admin-user failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
