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
          // Accent is an optional host tint. When the host doesn't pass
          // `theme.accentColor`, it falls back to the neutral foreground
          // so accent-tinted affordances stay visible in both light and
          // dark mode (a hardcoded fallback would vanish on the dark bg).
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
        // Square by default (`--koe-radius` unset → 0). Hosts can opt into
        // rounded chrome via `theme.radius`; every widget surface reads
        // this token so the panel, launcher, buttons and fields round
        // together instead of drifting apart.
        koe: 'var(--koe-radius, 0)',
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
