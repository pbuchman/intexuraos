import { useCallback, useEffect, useState } from 'react';
import type { ActionStatus } from '@/types';
import type { ActionSortKey, CommandSortKey, TabId } from './types.js';

const VALID_STATUSES: ActionStatus[] = [
  'awaiting_approval',
  'rejected',
  'completed',
  'failed',
  'processing',
];

function loadInitialFilter(): ActionStatus[] {
  const stored = localStorage.getItem('inbox-status-filter');
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is ActionStatus => VALID_STATUSES.includes(s as ActionStatus));
      }
    } catch {
      /* invalid */
    }
  }
  return ['awaiting_approval', 'failed', 'processing'];
}

export interface UseInboxPreferencesResult {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  statusFilter: ActionStatus[];
  toggleStatus: (s: ActionStatus) => void;
  clearStatuses: () => void;
  isFilterExpanded: boolean;
  toggleFilterExpanded: () => void;
  actionSort: ActionSortKey;
  setActionSort: (k: ActionSortKey) => void;
  commandSort: CommandSortKey;
  setCommandSort: (k: CommandSortKey) => void;
}

export function useInboxPreferences(): UseInboxPreferencesResult {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = localStorage.getItem('inbox-active-tab');
    return stored === 'actions' || stored === 'commands' ? stored : 'actions';
  });
  const [statusFilter, setStatusFilter] = useState<ActionStatus[]>(loadInitialFilter);
  const [isFilterExpanded, setIsFilterExpanded] = useState(
    () => localStorage.getItem('inbox-filter-expanded') === 'true'
  );
  const [actionSort, setActionSort] = useState<ActionSortKey>(() =>
    localStorage.getItem('inbox-sort-actions') === 'status' ? 'status' : 'created'
  );
  const [commandSort, setCommandSort] = useState<CommandSortKey>(() =>
    localStorage.getItem('inbox-sort-commands') === 'type' ? 'type' : 'created'
  );

  useEffect(() => { localStorage.setItem('inbox-active-tab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('inbox-status-filter', JSON.stringify(statusFilter)); }, [statusFilter]);
  useEffect(() => { localStorage.setItem('inbox-sort-actions', actionSort); }, [actionSort]);
  useEffect(() => { localStorage.setItem('inbox-sort-commands', commandSort); }, [commandSort]);

  const toggleStatus = useCallback((status: ActionStatus): void => {
    setStatusFilter((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }, []);
  const clearStatuses = useCallback((): void => { setStatusFilter([]); }, []);
  const toggleFilterExpanded = useCallback((): void => {
    setIsFilterExpanded((prev) => {
      localStorage.setItem('inbox-filter-expanded', String(!prev));
      return !prev;
    });
  }, []);

  return {
    activeTab, setActiveTab,
    statusFilter, toggleStatus, clearStatuses,
    isFilterExpanded, toggleFilterExpanded,
    actionSort, setActionSort,
    commandSort, setCommandSort,
  };
}
