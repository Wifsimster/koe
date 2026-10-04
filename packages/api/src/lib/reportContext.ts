import type { z } from 'zod';
import { redactText, redactUrl } from '@koe/shared';
import type { metadataSchema, reporterSchema } from './schemas';

type Metadata = z.infer<typeof metadataSchema>;
type Reporter = z.infer<typeof reporterSchema>;

/**
 * Server-side redaction pass on a URL. Widgets that already redacted
 * client-side (`redaction: 'query-values'`) keep the values they chose to
 * keep, minus sensitive names and token-like values. Anything else (older
 * widgets, hand-made clients) loses every query value.
 */
function serverRedactUrl(url: string, clientRedacted: boolean): string {
  if (!clientRedacted) return redactUrl(url);
  let names: string[] = [];
  try {
    names = [...new URL(url, 'http://relative.invalid').searchParams.keys()];
  } catch {
    // redactUrl handles the unparseable case.
  }
  return redactUrl(url, { keepQueryParams: names });
}

/**
 * Turns a validated widget payload into the `tickets.metadata` value:
 * redacts URLs, console text and action names again (never trust the
 * client), and keeps the host's `reporter.metadata` under
 * `reporterMetadata` instead of dropping it.
 */
export function sanitizeMetadata(metadata: Metadata, reporter: Reporter): Record<string, unknown> {
  const pre = metadata.redaction === 'query-values';
  const url = (u: string) => serverRedactUrl(u, pre);
  const target = <T extends { name?: string }>(t: T): T =>
    t.name === undefined ? t : { ...t, name: redactText(t.name, 200) };

  const out: Record<string, unknown> = {
    ...metadata,
    url: url(metadata.url),
    redaction: 'query-values',
  };
  if (metadata.referrer) out.referrer = url(metadata.referrer);
  if (metadata.breadcrumbs) {
    out.breadcrumbs = metadata.breadcrumbs.map((b) =>
      b.type === 'navigation' ? { ...b, url: url(b.url) } : { ...b, target: target(b.target) },
    );
  }
  if (metadata.console) {
    out.console = metadata.console.map((e) => ({ ...e, message: redactText(e.message) }));
  }
  if (metadata.network) {
    out.network = metadata.network.map((e) => ({ ...e, url: url(e.url) }));
  }
  if (reporter.metadata && Object.keys(reporter.metadata).length > 0) {
    out.reporterMetadata = reporter.metadata;
  }
  return out;
}
