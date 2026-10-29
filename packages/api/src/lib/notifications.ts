import { Resend } from 'resend';
import type { schema } from '../db';

type ResendLike = Pick<Resend, 'emails'>;
type TicketRow = typeof schema.tickets.$inferSelect;
type ProjectInfo = { id: string; key: string; name: string };

let cachedClient: ResendLike | null | undefined;
let warnedMissingFrom = false;

export function getResendFromEnv(): ResendLike | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(
      '[koe/api] RESEND_API_KEY not set — email notifications disabled.',
    );
    cachedClient = null;
    return null;
  }
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

export function __setResendForTest(client: ResendLike | null | undefined): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '__setResendForTest must not be invoked in production — it is a unit-test seam.',
    );
  }
  cachedClient = client;
  warnedMissingFrom = false;
}

function resolveRecipient(): string | null {
  const owner = process.env.NOTIFY_OWNER_EMAIL?.trim();
  if (owner) return owner;
  const admin = process.env.ADMIN_EMAIL?.trim();
  if (admin) return admin;
  return null;
}

function resolveSender(): string | null {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (from) return from;
  if (!warnedMissingFrom) {
    console.warn(
      '[koe/api] RESEND_FROM_EMAIL is not set — skipping email notification.',
    );
    warnedMissingFrom = true;
  }
  return null;
}

function ticketUrl(ticketId: string): string | null {
  const base = process.env.DASHBOARD_PUBLIC_URL?.trim();
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/admin/tickets/${ticketId}`;
}

function buildSubject(row: TicketRow, project: ProjectInfo): string {
  const kindLabel = row.kind === 'bug' ? 'bug' : 'feature request';
  return `[Koe · ${project.name}] New ${kindLabel}: ${row.title}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBody(row: TicketRow, project: ProjectInfo): { html: string; text: string } {
  const kindLabel = row.kind === 'bug' ? 'Bug report' : 'Feature request';
  const reporter = row.reporterName
    ? `${row.reporterName}${row.reporterEmail ? ` <${row.reporterEmail}>` : ''}`
    : row.reporterEmail ?? row.reporterId;
  const link = ticketUrl(row.id);

  const textLines = [
    `${kindLabel} on ${project.name}`,
    '',
    `Title: ${row.title}`,
    `From:  ${reporter}${row.reporterVerified ? ' (verified)' : ''}`,
    '',
    row.description,
  ];
  if (link) {
    textLines.push('', `Open in dashboard: ${link}`);
  }

  const htmlParts = [
    `<p><strong>${escapeHtml(kindLabel)}</strong> on <strong>${escapeHtml(project.name)}</strong></p>`,
    `<p><strong>Title:</strong> ${escapeHtml(row.title)}<br/>`,
    `<strong>From:</strong> ${escapeHtml(reporter)}${row.reporterVerified ? ' <em>(verified)</em>' : ''}</p>`,
    `<p style="white-space:pre-wrap">${escapeHtml(row.description)}</p>`,
  ];
  if (link) {
    htmlParts.push(
      `<p><a href="${escapeHtml(link)}">Open in dashboard</a></p>`,
    );
  }

  return { html: htmlParts.join('\n'), text: textLines.join('\n') };
}

export async function notifyNewTicket(
  row: TicketRow,
  project: ProjectInfo,
): Promise<boolean> {
  const client = getResendFromEnv();
  if (!client) return false;

  const to = resolveRecipient();
  if (!to) return false;

  const from = resolveSender();
  if (!from) return false;

  const { html, text } = buildBody(row, project);

  try {
    const response = await client.emails.send({
      from,
      to,
      subject: buildSubject(row, project),
      html,
      text,
    });
    const data = (response as { data?: { id?: string } | null; error?: unknown }) ?? {};
    if (data.error) {
      console.error('[koe/api] notifyNewTicket rejected by Resend', data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[koe/api] notifyNewTicket failed', err);
    return false;
  }
}

export type TestEmailResult =
  | { ok: true; to: string; from: string; messageId: string | null }
  | {
      ok: false;
      reason: 'no_api_key' | 'no_sender' | 'no_recipient' | 'send_failed';
      detail?: string;
    };

const TEST_EMAIL_SUBJECT = '[Koe] Test email — your Resend integration is working';

function buildTestBody(): { html: string; text: string } {
  const text = [
    'This is a test email from Koe.',
    '',
    'If you can read this, your Resend integration is correctly',
    'configured and new bug / feature submissions will reach this',
    'inbox. You can safely delete this message.',
  ].join('\n');
  const html = [
    '<p><strong>This is a test email from Koe.</strong></p>',
    '<p>If you can read this, your Resend integration is correctly configured ',
    'and new bug / feature submissions will reach this inbox. ',
    'You can safely delete this message.</p>',
  ].join('');
  return { html, text };
}

export async function sendTestEmail(opts: { to?: string } = {}): Promise<TestEmailResult> {
  const client = getResendFromEnv();
  if (!client) return { ok: false, reason: 'no_api_key' };

  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) return { ok: false, reason: 'no_sender' };

  const to = opts.to?.trim() || resolveRecipient();
  if (!to) return { ok: false, reason: 'no_recipient' };

  const { html, text } = buildTestBody();

  try {
    const response = await client.emails.send({
      from,
      to,
      subject: TEST_EMAIL_SUBJECT,
      html,
      text,
    });
    const data = (response as { data?: { id?: string } | null; error?: unknown }) ?? {};
    if (data.error) {
      const msg =
        typeof data.error === 'object' && data.error && 'message' in data.error
          ? String((data.error as { message: unknown }).message)
          : 'Resend rejected the request';
      return { ok: false, reason: 'send_failed', detail: msg };
    }
    return { ok: true, to, from, messageId: data.data?.id ?? null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown Resend error';
    console.error('[koe/api] sendTestEmail failed', err);
    return { ok: false, reason: 'send_failed', detail };
  }
}
