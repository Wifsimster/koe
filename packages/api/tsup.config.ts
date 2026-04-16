import { defineConfig } from 'tsup';

// Bundles the API into a few ESM entrypoints so the Docker runtime stage
// doesn't need pnpm, workspace symlinks, or the TypeScript source tree.
// `@koe/shared` is intentionally inlined to avoid shipping the workspace
// graph.
export default defineConfig({
  entry: {
    serve: 'src/bin/serve.ts',
    migrate: 'src/bin/migrate.ts',
    bootstrap: 'src/bin/bootstrap.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
  // Keep runtime deps external; they're installed via the production
  // `package.json` in the image. Only inline workspace packages.
  noExternal: [/^@koe\//],
});
