import { useEffect, type RefObject } from 'react';

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
    vv.addEventListener('resize', write, { passive: true });
    vv.addEventListener('scroll', write, { passive: true });
    return () => {
      vv.removeEventListener('resize', write);
      vv.removeEventListener('scroll', write);
    };
  }, [targetRef]);
}
