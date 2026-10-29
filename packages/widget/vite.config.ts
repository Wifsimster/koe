import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = process.env.BUILD_TARGET ?? 'lib';

function widgetVersion(): string {
  if (process.env.KOE_WIDGET_VERSION) return process.env.KOE_WIDGET_VERSION;
  try {
    return execFileSync('git', ['describe', '--tags', '--always', '--match', 'v*'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}
const versionDefine = { __KOE_WIDGET_VERSION__: JSON.stringify(widgetVersion()) };

export default defineConfig(() => {
  if (target === 'standalone') {
    return {
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        ...versionDefine,
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
          external: [],
          output: {
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
        rollupTypes: true,
        bundledPackages: ['@koe/shared'],
      }),
    ],
    define: versionDefine,
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
        external: (id) => /^react($|\/)|^react-dom($|\/)/.test(id),
      },
      sourcemap: true,
    },
  };
});
