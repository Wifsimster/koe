import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    serve: 'src/bin/serve.ts',
    migrate: 'src/bin/migrate.ts',
    bootstrap: 'src/bin/bootstrap.ts',
    'hash-password': 'src/bin/hash-password.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
  noExternal: [/^@koe\//],
  external: ['./migrate.js', './bootstrap.js', './serve.js', './hash-password.js'],
});
