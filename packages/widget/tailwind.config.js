/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  // All Koe classes are prefixed to avoid colliding with the host app's
  // Tailwind or other CSS utilities.
  prefix: 'koe-',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        koe: {
          accent: 'var(--koe-accent, #0a0a0a)',
          'accent-hover': 'var(--koe-accent-hover, #262626)',
          bg: 'var(--koe-bg)',
          'bg-muted': 'var(--koe-bg-muted)',
          border: 'var(--koe-border)',
          text: 'var(--koe-text)',
          'text-muted': 'var(--koe-text-muted)',
          'text-hover': 'var(--koe-text-hover)',
        },
      },
      boxShadow: {
        // Subtle two-layer shadow — matches the editorial feel without
        // the heavy drop the purple accent used to need for contrast.
        koe: '0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -10px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
};
