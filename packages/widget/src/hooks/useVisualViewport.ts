import { useEffect, type RefObject } from 'react';

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
 *
 * Takes a `RefObject` (rather than a raw element) so the hook can read
 * `ref.current` *inside* the effect — by the time the effect runs, React
 * has populated the ref with the attached DOM node. Passing the raw
 * `ref.current` from the render body would always be `null` on first
 * render and the dep array wouldn't pick up the eventual attach.
 */
export function useVisualViewport(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const write = () => {
      target.style.setProperty('--koe-vvh', `${vv.height}px`);
    };

    write();
    // The handler only writes a CSS variable — it never calls
    // preventDefault — so both listeners are safe to mark passive and
    // keep the viewport scroll off the main thread.
    vv.addEventListener('resize', write, { passive: true });
    vv.addEventListener('scroll', write, { passive: true });
    return () => {
      vv.removeEventListener('resize', write);
      vv.removeEventListener('scroll', write);
    };
    // The ref *object* is stable across renders, but `ref.current` is
    // populated by React after the first commit. Depending on the ref
    // identity is enough here because Panel mounts the shell only when
    // open — the effect re-runs the next time the dialog opens with a
    // fresh node attached.
  }, [targetRef]);
}
