import { useEffect } from 'react';
import type { Action } from '@/types';

interface UseInboxDeepLinkOpts {
  actions: Action[];
  fetchActionById: (id: string) => Promise<Action | null>;
  onAction: (a: Action) => void;
}

/**
 * Reads `?action=<id>` from the location hash and either selects an in-list
 * action or fetches it on-demand. Cleans the URL after consuming.
 */
export function useInboxDeepLink({ actions, fetchActionById, onAction }: UseInboxDeepLinkOpts): void {
  useEffect(() => {
    const hash = window.location.hash;
    const queryString = hash.includes('?') ? hash.split('?')[1] : '';
    if (queryString === '') return;
    const params = new URLSearchParams(queryString);
    const actionId = params.get('action');
    if (actionId === null) return;
    const cleanHash = hash.split('?')[0] ?? '';
    window.history.replaceState(null, '', cleanHash !== '' ? cleanHash : window.location.pathname);
    const inList = actions.find((a) => a.id === actionId);
    if (inList !== undefined) {
      onAction(inList);
      return;
    }
    const fetchKey = `fetched-action-${actionId}`;
    if (sessionStorage.getItem(fetchKey) === 'true') return;
    sessionStorage.setItem(fetchKey, 'true');
    void (async (): Promise<void> => {
      const a = await fetchActionById(actionId);
      if (a !== null) onAction(a);
    })();
  }, [actions, fetchActionById, onAction]);
}
