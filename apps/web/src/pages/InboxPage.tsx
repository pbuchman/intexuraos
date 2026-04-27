import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBanner, Layout } from '@/components';
import { InboxFilters } from '@/components/inbox/InboxFilters.js';
import type { Action, Command } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { Loader2 } from 'lucide-react';
import { InboxHeader } from './inbox/InboxHeader.js';
import { InboxTabs } from './inbox/InboxTabs.js';
import { InboxSortBar } from './inbox/InboxSortBar.js';
import { InboxActionsList } from './inbox/InboxActionsList.js';
import { InboxCommandsList } from './inbox/InboxCommandsList.js';
import { InboxModals } from './inbox/InboxModals.js';
import { useInboxData } from './inbox/useInboxData.js';
import { useInboxPreferences } from './inbox/useInboxPreferences.js';
import { useInboxDeepLink } from './inbox/useInboxDeepLink.js';
import {
  ACTION_SORT_OPTIONS,
  COMMAND_SORT_OPTIONS,
  getActionsCountByStatus,
  sortActions,
  sortCommands,
  type TabId,
} from './inbox/types.js';

export function InboxPage(): React.JSX.Element {
  const prefs = useInboxPreferences();
  const { activeTab, setActiveTab, statusFilter } = prefs;

  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<Command | null>(null);

  const data = useInboxData(activeTab, statusFilter);
  const {
    commands, actions, setActions,
    commandsCursor, actionsCursor,
    isLoading, isLoadingMore, isRefreshing,
    error, listenerError,
    fetchData, loadMoreCommands, loadMoreActions,
    deleteCommandById, archiveCommandById,
    deletingCommandId, archivingCommandId,
    fetchActionById,
  } = data;

  const previousTabRef = useRef<TabId>(activeTab);
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const statusFilterRef = useRef(statusFilter);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (previousTabRef.current !== activeTab && !isLoadingRef.current) void fetchData(true);
    previousTabRef.current = activeTab;
  }, [activeTab, fetchData]);

  useEffect(() => {
    const same =
      statusFilterRef.current.length === statusFilter.length &&
      statusFilterRef.current.every((s, i) => s === statusFilter[i]);
    if (same) return;
    statusFilterRef.current = statusFilter;
    if (!isLoadingRef.current) void fetchData(true);
  }, [statusFilter, fetchData]);

  const onDeepLinkAction = useCallback((a: Action): void => { setSelectedAction(a); }, []);
  useInboxDeepLink({ actions, fetchActionById, onAction: onDeepLinkAction });

  const currentCursor = activeTab === 'commands' ? commandsCursor : actionsCursor;
  const handleLoadMore = activeTab === 'commands' ? loadMoreCommands : loadMoreActions;

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting === true && currentCursor !== undefined && !isLoadingMore) {
        void handleLoadMore();
      }
    }, { threshold: 0.1 });
    const ref = loadMoreRef.current;
    if (ref !== null) observer.observe(ref);
    return (): void => { if (ref !== null) observer.unobserve(ref); };
  }, [currentCursor, isLoadingMore, handleLoadMore]);

  const pendingCount = useMemo(() => actions.filter((a) => a.status === 'pending').length, [actions]);
  const sortedActions = useMemo(() => sortActions(actions, prefs.actionSort), [actions, prefs.actionSort]);
  const sortedCommands = useMemo(() => sortCommands(commands, prefs.commandSort), [commands, prefs.commandSort]);
  const actionsCountByStatus = useMemo(() => getActionsCountByStatus(actions), [actions]);
  const headerSubtitle = activeTab === 'actions'
    ? `${String(actions.length)} actions · ${String(pendingCount)} pending`
    : `${String(commands.length)} commands`;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const handleActionSuccess = (button: ResolvedActionButton): void => {
    if (button.endpoint.method === 'DELETE') {
      setActions((prev) => prev.filter((a) => a.id !== button.action.id));
    } else if (button.endpoint.method === 'PATCH' || button.endpoint.method === 'POST') {
      void fetchData(true);
    }
  };
  const handleActionUpdated = (updated: Action): void => {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };
  const handleModalActionSuccess = (button: ResolvedActionButton): void => {
    if (button.endpoint.method === 'DELETE') {
      setActions((prev) => prev.filter((a) => a.id !== button.action.id));
    }
    setSelectedAction(null);
  };
  const handleModalActionUpdated = (updated: Action): void => {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelectedAction(updated);
  };

  return (
    <Layout>
      <InboxHeader subtitle={headerSubtitle} isRefreshing={isRefreshing} onRefresh={(): void => { void fetchData(true); }} />
      {listenerError !== null && listenerError !== '' ? (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          Real-time updates paused: {listenerError}
        </div>
      ) : null}
      <ErrorBanner message={error} className="mb-6" />
      <InboxTabs activeTab={activeTab} actionsCount={actions.length} commandsCount={commands.length} onChange={setActiveTab} />
      {activeTab === 'actions' && (
        <InboxFilters
          statusFilter={statusFilter}
          isFilterExpanded={prefs.isFilterExpanded}
          onToggleStatus={prefs.toggleStatus}
          onToggleExpanded={prefs.toggleFilterExpanded}
          onClearAll={prefs.clearStatuses}
          actionsCountByStatus={actionsCountByStatus}
        />
      )}
      {activeTab === 'actions' && (
        <InboxSortBar options={ACTION_SORT_OPTIONS} active={prefs.actionSort} onChange={prefs.setActionSort} />
      )}
      {activeTab === 'commands' && (
        <InboxSortBar options={COMMAND_SORT_OPTIONS} active={prefs.commandSort} onChange={prefs.setCommandSort} />
      )}
      <div className="space-y-3">
        {activeTab === 'actions' && (
          <InboxActionsList
            actions={sortedActions}
            hasFilters={statusFilter.length > 0}
            onSelect={setSelectedAction}
            onActionSuccess={handleActionSuccess}
            onActionUpdated={handleActionUpdated}
          />
        )}
        {activeTab === 'commands' && (
          <InboxCommandsList
            commands={sortedCommands}
            deletingCommandId={deletingCommandId}
            archivingCommandId={archivingCommandId}
            onSelect={setSelectedCommand}
            onDelete={(id): void => { void deleteCommandById(id); }}
            onArchive={(id): void => { void archiveCommandById(id); }}
          />
        )}
      </div>
      {currentCursor !== undefined && (
        <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
          {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-blue-600" />}
        </div>
      )}
      <InboxModals
        selectedAction={selectedAction}
        selectedCommand={selectedCommand}
        commands={commands}
        onCloseAction={(): void => { setSelectedAction(null); }}
        onCloseCommand={(): void => { setSelectedCommand(null); }}
        onActionSuccess={handleModalActionSuccess}
        onActionUpdated={handleModalActionUpdated}
      />
    </Layout>
  );
}
