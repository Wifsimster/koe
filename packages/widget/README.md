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
        position="bottom-right"
        theme={{ accentColor: '#4f46e5' }}
      />
    </>
  );
}
```

### Standalone script tag

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

## Configuration

| Option        | Type                | Default         |
|---------------|---------------------|-----------------|
| `projectKey`  | `string`            | **required**    |
| `user`        | `WidgetUser`        | anonymous       |
| `apiUrl`      | `string`            | `https://api.koe.dev` |
| `position`    | `WidgetPosition`    | `bottom-right`  |
| `theme`       | `WidgetTheme`       | indigo, auto    |
| `features`    | `{ bugs?, features?, chat? }` | all enabled |
| `locale`      | `Partial<WidgetLocale>` | English     |

See `src/types/widget.ts` in `@koe/shared` for the full type definitions.
