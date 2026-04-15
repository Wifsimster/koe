/**
 * End-user of a host SaaS app, as identified by the widget at init time.
 * This is NOT a dashboard admin account — those are managed by better-auth.
 */
export interface WidgetUser {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  /** Arbitrary metadata forwarded from the host app (plan, role, etc.). */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Dashboard administrator. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
