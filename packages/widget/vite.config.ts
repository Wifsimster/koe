import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The widget ships two builds from the same source:
 *
 * 1. **Library build** (`BUILD_TARGET=lib`, the default): consumed via
 *    `import { KoeWidget } from '@wifsimster/koe'`. Externalizes React
 *    and its JSX runtime so the host app supplies them.
 *
 * 2. **Standalone IIFE build** (`BUILD_TARGET=standalone`): shipped to
 *    a CDN and loaded via `<script src="widget.js">`. Bundles React and
 *    the JSX runtime so there's no `window.React` dependency.
 *
 * Both builds run sequentially from the `build` script in package.json.
 */
const target = process.env.BUILD_TARGET ?? 'lib';

export default defineConfig(() => {
  if (target === 'standalone') {
    return {
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/standalone-entry.ts'),
          name: 'Koe',
          formats: ['iife'],
          fileName: () => 'koe.iife.js',
          cssFileName: 'style',
        },
        rollupOptions: {
          // Nothing external — the CDN bundle must be self-contained.
          external: [],
          output: {
            // Make sure we expose `window.Koe` with `init` / `destroy`.
            extend: true,
          },
        },
        sourcemap: true,
      },
    };
  }

  return {
    plugins: [
      react(),
      dts({
        include: ['src'],
        // Inline types from @koe/shared (workspace dep, not published)
        // into the rolled-up declaration file. Without this api-extractor
        // leaves `import { ... } from '@koe/shared'` in the output and
        // consumers see phantom imports to a private package.
        rollupTypes: true,
        bundledPackages: ['@koe/shared'],
      }),
    ],
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'Koe',
        formats: ['es'],
        fileName: () => 'index.js',
        cssFileName: 'style',
      },
      rollupOptions: {
        // Match bare specifiers AND subpaths (`react-dom/client`,
        // `react/jsx-runtime`, etc.). A plain string list only matches
        // exact IDs, so `react-dom/client` — pulled in by `standalone.ts`
        // for `createRoot` — would otherwise be bundled along with its
        // internal React references, yanking a second React copy into
        // the host app and triggering React error #527.
        external: (id) => /^react($|\/)|^react-dom($|\/)/.test(id),
      },
      sourcemap: true,
    },
  };
});
