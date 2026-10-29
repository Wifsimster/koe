export interface WidgetUser {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
