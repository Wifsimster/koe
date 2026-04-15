/**
 * A project represents one host SaaS app that embeds the Koe widget.
 * Identified by `key` — the `projectKey` passed into `Koe.init`.
 */
export interface Project {
  id: string;
  key: string;
  name: string;
  /** Hex color used as the widget accent color. */
  accentColor: string;
  /** Origins allowed to initialize the widget with this project key. */
  allowedOrigins: string[];
  createdAt: string;
}
