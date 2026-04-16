import { useEffect } from 'react';

/**
 * Mirrors `window.visualViewport.height` into a CSS custom property on
 * the given element. Lets CSS size the panel to the *visible* viewport
 * (which shrinks when a mobile keyboard pops open) without triggering a
 * React re-render on every `resize` event.
 *
 * Why the DOM-side update instead of state: the mobile keyboard fires
 * `resize` events at 60fps on some Android Chrome builds. A React state
 * update for each one stutters the input caret. Writing a CSS variable
 * is the cheapest thing we can do and the browser coalesces repaints.
 *
 * Sets `--koe-vvh` in pixels. Consumers use it like:
 *   max-height: min(85dvh, calc(var(--koe-vvh, 100vh) * 0.85));
 *
 * Falls back to `100vh`-equivalent on browsers without visualViewport
 * (very old Safari), which matches the previous behavior.
 */
export function useVisualViewport(target: HTMLElement | null): void {
  useEffect(() => {
    if (!target) return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const write = () => {
      target.style.setProperty('--koe-vvh', `${vv.height}px`);
    };

    write();
    vv.addEventListener('resize', write);
    vv.addEventListener('scroll', write);
    return () => {
      vv.removeEventListener('resize', write);
      vv.removeEventListener('scroll', write);
    };
  }, [target]);
}
