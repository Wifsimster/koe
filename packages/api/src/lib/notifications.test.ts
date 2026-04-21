import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { schema } from '../db';
import {
  __setResendForTest,
  getResendFromEnv,
  notifyNewTicket,
  sendTestEmail,
} from './notifications';

type TicketRow = typeof schema.tickets.$inferSelect;

const projectInfo = {
  id: '11111111-1111-1111-1111-111111111111',
  key: 'acme',
  name: 'Acme',
};

function makeBugRow(overrides: Partial<TicketRow> = {}): TicketRow {
  const now = new Date('2026-01-15T10:00:00Z');
  return {
    id: '22222222-2222-2222-2222-222222222222',
    projectId: projectInfo.id,
    kind: 'bug',
    title: 'Submit button does nothing',
    description: 'Clicking submit on the form has no effect.',
    status: 'open',
    priority: 'medium',
    reporterId: 'user-42',
    reporterName: 'Ada Lovelace',
    reporterEmail: 'ada@example.com',
    reporterVerified: true,
    stepsToReproduce: 'Open form, click submit',
    expectedBehavior: 'Submit',
    actualBehavior: 'Nothing',
    metadata: null,
    screenshotUrl: null,
    notes: null,
    isPublicRoadmap: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface SentEmail {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

function makeFakeResend(opts: {
  throwOnSend?: boolean;
  resendError?: { message: string };
  messageId?: string;
} = {}) {
  const sent: SentEmail[] = [];
  const client = {
    emails: {
      send: async (payload: SentEmail) => {
        if (opts.throwOnSend) throw new Error('boom from Resend');
        sent.push(payload);
        if (opts.resendError) {
          return { data: null, error: opts.resendError };
        }
        return { data: { id: opts.messageId ?? 'fake-id' }, error: null };
      },
    },
  };
  // The real `Resend` instance has many other members. We only ever
  // touch `emails.send` from production code, so the cast is safe and
  // keeps the test fixture small.
  return { client: client as unknown as Parameters<typeof __setResendForTest>[0], sent };
}

const ENV_KEYS = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'NOTIFY_OWNER_EMAIL',
  'ADMIN_EMAIL',
  'DASHBOARD_PUBLIC_URL',
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearEnv();
  __setResendForTest(undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __setResendForTest(undefined);
});

describe('getResendFromEnv', () => {
  it('returns null when RESEND_API_KEY is not set', () => {
    assert.equal(getResendFromEnv(), null);
  });

  it('caches the null result so we only log once', () => {
    const first = getResendFromEnv();
    const second = getResendFromEnv();
    assert.equal(first, null);
    assert.equal(second, null);
  });
});

describe('notifyNewTicket', () => {
  it('is a silent no-op when RESEND_API_KEY is missing', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const sent = await notifyNewTicket(makeBugRow(), projectInfo);
    assert.equal(sent, false);
  });

  it('sends the email on the happy path', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';
    process.env.DASHBOARD_PUBLIC_URL = 'https://koe.example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const sent = await notifyNewTicket(makeBugRow(), projectInfo);

    assert.equal(sent, true);
    assert.equal(fake.sent.length, 1);
    const email = fake.sent[0]!;
    assert.equal(email.from, 'koe@example.com');
    assert.equal(email.to, 'owner@example.com');
    assert.match(email.subject, /Acme/);
    assert.match(email.subject, /Submit button does nothing/);
    assert.match(email.subject, /bug/);
    assert.ok(email.text?.includes('ada@example.com'));
    assert.ok(
      email.html?.includes('https://koe.example.com/admin/tickets/' + makeBugRow().id),
    );
  });

  it('falls back to ADMIN_EMAIL when NOTIFY_OWNER_EMAIL is unset', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const sent = await notifyNewTicket(makeBugRow({ kind: 'feature' }), projectInfo);

    assert.equal(sent, true);
    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0]!.to, 'admin@example.com');
    assert.match(fake.sent[0]!.subject, /feature request/);
  });

  it('prefers NOTIFY_OWNER_EMAIL over ADMIN_EMAIL', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    await notifyNewTicket(makeBugRow(), projectInfo);

    assert.equal(fake.sent[0]!.to, 'owner@example.com');
  });

  it('skips when no recipient is configured', async () => {
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const sent = await notifyNewTicket(makeBugRow(), projectInfo);
    assert.equal(sent, false);
    assert.equal(fake.sent.length, 0);
  });

  it('skips when RESEND_FROM_EMAIL is missing', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const sent = await notifyNewTicket(makeBugRow(), projectInfo);
    assert.equal(sent, false);
    assert.equal(fake.sent.length, 0);
  });

  it('swallows errors from Resend.send and resolves to false', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend({ throwOnSend: true });
    __setResendForTest(fake.client);

    const sent = await notifyNewTicket(makeBugRow(), projectInfo);
    assert.equal(sent, false);
  });

  it('omits the dashboard link when DASHBOARD_PUBLIC_URL is unset', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    await notifyNewTicket(makeBugRow(), projectInfo);

    const email = fake.sent[0]!;
    assert.ok(!email.text?.includes('Open in dashboard'));
    assert.ok(!email.html?.includes('Open in dashboard'));
  });

  it('escapes HTML in the body', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    await notifyNewTicket(
      makeBugRow({
        title: '<script>alert(1)</script>',
        description: 'a < b & c > d',
      }),
      projectInfo,
    );

    const email = fake.sent[0]!;
    assert.ok(!email.html?.includes('<script>alert(1)</script>'));
    assert.ok(email.html?.includes('&lt;script&gt;'));
    assert.ok(email.html?.includes('a &lt; b &amp; c &gt; d'));
  });
});

describe('sendTestEmail', () => {
  it('reports no_api_key when RESEND_API_KEY is missing', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const result = await sendTestEmail();

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'no_api_key');
  });

  it('reports no_sender when RESEND_FROM_EMAIL is missing', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'no_sender');
    assert.equal(fake.sent.length, 0);
  });

  it('reports no_recipient when no override and no env recipient', async () => {
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'no_recipient');
    assert.equal(fake.sent.length, 0);
  });

  it('sends a test email to the env-resolved recipient on the happy path', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend({ messageId: 'msg_abc' });
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.to, 'owner@example.com');
    assert.equal(result.from, 'koe@example.com');
    assert.equal(result.messageId, 'msg_abc');
    assert.equal(fake.sent.length, 1);
    assert.match(fake.sent[0]!.subject, /Test email/i);
    assert.ok(fake.sent[0]!.text?.includes('test email from Koe'));
  });

  it('overrides the recipient when `to` is provided', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const result = await sendTestEmail({ to: 'me@personal.com' });

    assert.equal(result.ok, true);
    assert.equal(fake.sent[0]!.to, 'me@personal.com');
  });

  it('falls back to ADMIN_EMAIL when NOTIFY_OWNER_EMAIL is unset', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend();
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, true);
    assert.equal(fake.sent[0]!.to, 'admin@example.com');
  });

  it('reports send_failed with the error message when Resend throws', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend({ throwOnSend: true });
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'send_failed');
    assert.match((result as { detail: string }).detail, /boom from Resend/);
  });

  it('reports send_failed when Resend returns an error envelope', async () => {
    process.env.NOTIFY_OWNER_EMAIL = 'owner@example.com';
    process.env.RESEND_FROM_EMAIL = 'koe@example.com';

    const fake = makeFakeResend({
      resendError: { message: 'Domain is not verified' },
    });
    __setResendForTest(fake.client);

    const result = await sendTestEmail();

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'send_failed');
    assert.match((result as { detail: string }).detail, /Domain is not verified/);
  });
});
