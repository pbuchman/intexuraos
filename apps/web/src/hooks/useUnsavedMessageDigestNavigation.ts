import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';

export interface UnsavedMessageDigestNavigation {
  isBlocked: boolean;
  keepEditing: () => void;
  discardChanges: () => void;
  disarm: () => void;
}

export function useUnsavedMessageDigestNavigation(
  dirty: boolean
): UnsavedMessageDigestNavigation {
  const dirtyRef = useRef(dirty);
  const disarmedRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) disarmedRef.current = false;
  }, [dirty]);

  const blocker = useBlocker(
    useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
      const isSameLocation =
        currentLocation.pathname === nextLocation.pathname &&
        currentLocation.search === nextLocation.search &&
        currentLocation.hash === nextLocation.hash;
      if (isSameLocation || !dirtyRef.current || disarmedRef.current) return false;
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return true;
    }, [])
  );

  useEffect(() => {
    if (blocker.state !== 'unblocked' || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const focusTimer = window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    return (): void => {
      window.clearTimeout(focusTimer);
    };
  }, [blocker.state]);

  const keepEditing = useCallback((): void => {
    if (blocker.state !== 'blocked') return;
    restoreFocusRef.current = true;
    blocker.reset();
  }, [blocker]);

  const discardChanges = useCallback((): void => {
    if (blocker.state !== 'blocked') return;
    disarmedRef.current = true;
    blocker.proceed();
  }, [blocker]);

  const disarm = useCallback((): void => {
    disarmedRef.current = true;
  }, []);

  return {
    isBlocked: blocker.state === 'blocked',
    keepEditing,
    discardChanges,
    disarm,
  };
}
