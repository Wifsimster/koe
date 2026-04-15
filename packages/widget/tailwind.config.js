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
      colors: {
        koe: {
          accent: 'var(--koe-accent, #4f46e5)',
          'accent-hover': 'var(--koe-accent-hover, #4338ca)',
          bg: 'var(--koe-bg, #ffffff)',
          'bg-muted': 'var(--koe-bg-muted, #f9fafb)',
          border: 'var(--koe-border, #e5e7eb)',
          text: 'var(--koe-text, #111827)',
          'text-muted': 'var(--koe-text-muted, #6b7280)',
        },
      },
      boxShadow: {
        koe: '0 10px 40px -10px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
};
