import type { CSSProperties } from 'react';
import type { WidgetPosition, WidgetTheme } from '@koe/shared';

export function positionToClasses(position: WidgetPosition): string {
  switch (position) {
    case 'bottom-right':
      return 'koe-bottom-4 koe-right-4';
    case 'bottom-left':
      return 'koe-bottom-4 koe-left-4';
    case 'top-right':
      return 'koe-top-4 koe-right-4';
    case 'top-left':
      return 'koe-top-4 koe-left-4';
  }
}

export function themeVars(theme?: WidgetTheme): CSSProperties {
  const vars: Record<string, string> = {};
  if (theme?.accentColor) {
    vars['--koe-accent'] = theme.accentColor;
    vars['--koe-accent-hover'] = darken(theme.accentColor, 0.08);
  }
  if (theme?.radius !== undefined) {
    vars['--koe-radius'] = `${theme.radius}px`;
  }
  return vars as CSSProperties;
}

/**
 * Very small HSL-free darkener. Accepts `#rgb` or `#rrggbb` and returns
 * a new hex string with each channel scaled by (1 - amount).
 */
function darken(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const scale = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(scale(r))}${toHex(scale(g))}${toHex(scale(b))}`;
}
