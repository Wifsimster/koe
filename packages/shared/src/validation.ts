/**
 * Minimal shape check for email addresses. Deliberately permissive —
 * real deliverability belongs to the mail server, not a widget form.
 * Empty strings are "not provided" and should be filtered out before
 * calling this.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}
