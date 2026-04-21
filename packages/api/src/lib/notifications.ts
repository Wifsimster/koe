import { Resend } from 'resend';
import type { schema } from '../db';

/**
 * Email notifications for new widget submissions, via Resend.
 *
 * Design notes:
 * - Lazy-init: the Resend client is only constructed on first use, and
 *   only when `RESEND_API_KEY` is set. Without it, every entry point
 *   here is a silent no-op — the widget keeps working unchanged on
 *   deployments that haven't set up email yet.
 * - Single-admin product: recipient resolution is `NOTIFY_OWNER_EMAIL`
 *   then `ADMIN_EMAIL`, then skip. The `notifyNewTicket(row, project)`
 *   signature already takes the project so the future per-project
 *   `role='owner'` lookup is a one-liner change to the resolver.
 * - Fire-and-forget at the call site (`void notifyNewTicket(...)`):
 *   widget latency must never depend on Resend availability. Errors
 *   are logged and swallowed here so the caller doesn't have to.
 */

type ResendLike = Pick<Resend, 'emails'>;
type TicketRow = typeof schema.tickets.$inferSelect;
type ProjectInfo = { id: string; key: string; name: string };

let cachedClient: ResendLike | null | undefined;
let warnedMissingFrom = false;

/**
 * Returns a Resend client lazily, or `null` if `RESEND_API_KEY` is
 * absent. Logs once on the first call so an operator running without
 * email knows the surface is intentionally off, not silently broken.
 */
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

/**
 * Test seam. Lets unit tests inject a fake Resend without touching
 * env vars or the global cache between cases. Pass `null` to force
 * the no-op path; pass `undefined` to clear the cache so the next
 * call re-reads `RESEND_API_KEY`.
 */
export function __setResendForTest(client: ResendLike | null | undefined): void {
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

/**
 * Sends a "new ticket" email to the configured owner. Returns `true`
 * when an email was dispatched, `false` when it was skipped (no client,
 * no recipient, no sender). Never throws — Resend errors are logged.
 *
 * Always call as `void notifyNewTicket(row, project)` from request
 * handlers: the widget response must not wait on Resend.
 */
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
    await client.emails.send({
      from,
      to,
      subject: buildSubject(row, project),
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error('[koe/api] notifyNewTicket failed', err);
    return false;
  }
}

/**
 * Result of `sendTestEmail`. The discriminant lets the admin route map
 * each case to the right HTTP status without leaking implementation
 * details: `no_api_key`/`no_sender`/`no_recipient` map to 422 (operator
 * needs to fix env), `send_failed` maps to 502 (Resend rejected us),
 * `ok` maps to 200.
 */
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

/**
 * Sends a one-off test email to verify Resend is correctly wired up.
 * Driven by the admin "send test email" button — surfaces every
 * common misconfiguration (missing API key, missing sender, missing
 * recipient, Resend rejection) as a structured result instead of
 * silent no-op, so the operator gets actionable feedback instead of
 * "did anything happen?".
 *
 * Pass `to` to override the recipient resolver — useful when the admin
 * wants to send a probe to their personal inbox rather than the
 * configured owner address.
 */
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
    // Resend returns `{ data: { id }, error }`. A non-null `error` is a
    // delivery rejection (bad sender domain, blocked recipient, …) and
    // must surface as a failure even though `send()` resolved.
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
