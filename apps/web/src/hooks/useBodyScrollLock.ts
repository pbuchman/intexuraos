/**
 * Freezes body scroll while the component invoking the hook is mounted.
 * Used by FilterSheet to prevent background page scroll on mobile.
 */
import { useEffect } from 'react';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return (): void => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
