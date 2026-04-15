# Koe (声)

> Embeddable support widget for SaaS apps — bug reports, feature requests & live chat in one unified experience.

## Overview

Koe is a lightweight, embeddable widget that provides a unified support experience across all your SaaS products. Drop it into any web application to give your users a consistent way to report bugs, request features, and chat with you directly.

## Features

- **Bug Reports** — Users can report issues with screenshots, browser metadata, and contextual information automatically attached.
- **Feature Requests** — Collect and prioritize feature ideas from your users with voting and status tracking.
- **Live Chat** — Real-time messaging between you and your users for quick support.
- **Unified Dashboard** — Manage all incoming tickets, requests, and conversations from a single admin panel, across all your products.
- **Multi-App Support** — One Koe instance serves all your SaaS apps. Each app is identified by a project key.
- **Embeddable Widget** — A single script tag to integrate into any web application.
- **Theming** — Adapts to your app's look and feel with customizable colors and positioning.

## Getting Started

### Installation

```bash
npm install @wifsimster/koe
```

### Usage

```html
<script src="https://cdn.koe.dev/widget.js"></script>
<script>
  Koe.init({
    projectKey: 'your-project-key',
    user: {
      id: 'user-123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    },
  });
</script>
```

Or with a framework (React, Vue, etc.):

```tsx
import { KoeWidget } from '@wifsimster/koe';

<KoeWidget
  projectKey="your-project-key"
  user={{ id: 'user-123', name: 'Jane Doe', email: 'jane@example.com' }}
/>
```

## Development

This is a [Turborepo](https://turbo.build/) monorepo using [pnpm](https://pnpm.io/) workspaces.

```bash
# Install dependencies
pnpm install

# Run all packages in dev mode
pnpm dev

# Build all packages
pnpm build

# Typecheck everything
pnpm typecheck
```

## Architecture

```
koe/
├── packages/
│   ├── widget/          # Embeddable frontend widget
│   ├── dashboard/       # Admin panel
│   ├── api/             # Backend API
│   └── shared/          # Shared types & utilities
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Widget      | React, TypeScript, Tailwind    |
| Dashboard   | React, TanStack Router, shadcn/ui |
| API         | Hono, Drizzle ORM, PostgreSQL  |
| Realtime    | WebSocket                      |
| Monorepo    | Turborepo, pnpm                |
| Auth        | better-auth                    |

## Roadmap

- [x] Widget core (bug report, feature request forms)
- [ ] Admin dashboard with multi-project support
- [ ] Live chat with WebSocket
- [ ] Email notifications
- [ ] Screenshot capture
- [ ] User voting on feature requests
- [ ] Public roadmap page
- [ ] Webhook integrations

## License

MIT © [wifsimster](https://github.com/wifsimster)
