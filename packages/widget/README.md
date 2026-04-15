# @wifsimster/koe

Embeddable support widget for SaaS apps — bug reports, feature requests & live chat in one unified experience.

## Install

```bash
npm install @wifsimster/koe
```

## Usage

### React / Framework

```tsx
import { KoeWidget } from '@wifsimster/koe';
import '@wifsimster/koe/style.css';

export function App() {
  return (
    <>
      {/* your app */}
      <KoeWidget
        projectKey="your-project-key"
        user={{ id: 'user-123', name: 'Jane Doe', email: 'jane@example.com' }}
        userHash={serverProvidedHash}
        position="bottom-right"
        theme={{ accentColor: '#4f46e5' }}
      />
    </>
  );
}
```

### Standalone script tag

```html
<script src="https://cdn.koe.dev/koe.iife.js"></script>
<script>
  Koe.init({
    projectKey: 'your-project-key',
    user: {
      id: 'user-123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    },
    userHash: 'a3f1…', // from your backend, see "Identity verification"
  });
</script>
```

The standalone build is a self-contained IIFE with React and its JSX
runtime bundled in. The npm build externalizes React — your host app
supplies it.

## Identity verification

The widget's `projectKey` is public by definition (it ships in browser
JS). To stop attackers from impersonating your users via
`reporter.email` or vote-stuffing the roadmap, generate an HMAC of the
user id on your backend and hand it to the widget:

```ts
// Your backend, never the browser.
import { createHmac } from 'node:crypto';

const userHash = createHmac('sha256', process.env.KOE_IDENTITY_SECRET)
  .update(user.id)
  .digest('hex');

// Inject into the page or return from an API endpoint.
res.json({ userHash });
```

When the project has `requireIdentityVerification` turned on, any
submission without a valid hash is rejected with `401 unauthorized`.

## Configuration

| Option        | Type                | Default         |
|---------------|---------------------|-----------------|
| `projectKey`  | `string`            | **required**    |
| `user`        | `WidgetUser`        | anonymous       |
| `userHash`    | `string`            | —               |
| `apiUrl`      | `string`            | `https://api.koe.dev` |
| `position`    | `WidgetPosition`    | `bottom-right`  |
| `theme`       | `WidgetTheme`       | indigo, auto    |
| `features`    | `{ bugs?, features?, chat? }` | all enabled |
| `locale`      | `Partial<WidgetLocale>` | English     |

See `src/types/widget.ts` in `@koe/shared` for the full type definitions.
