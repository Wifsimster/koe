export default {
  content: ['./src/**/*.{ts,tsx}'],
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
          accent: 'var(--koe-accent, var(--koe-text))',
          'accent-hover': 'var(--koe-accent-hover, var(--koe-text-hover))',
          bg: 'var(--koe-bg)',
          'bg-muted': 'var(--koe-bg-muted)',
          border: 'var(--koe-border)',
          text: 'var(--koe-text)',
          'text-muted': 'var(--koe-text-muted)',
          'text-hover': 'var(--koe-text-hover)',
        },
      },
      borderRadius: {
        koe: 'var(--koe-radius, 0)',
      },
      boxShadow: {
        koe: '0 1px 3px rgba(0,0,0,0.06), 0 10px 30px -10px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
};
