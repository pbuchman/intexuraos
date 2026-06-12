import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context';
import {
  ApiError,
  archiveCommand,
  batchGetActions,
  deleteCommand,
  getActions,
  getCommands,
} from '@/services';
import type { Action, ActionStatus, Command } from '@/types';
import { useActionChanges } from '@/hooks/useActionChanges';
import { useCommandChanges } from '@/hooks/useCommandChanges';
import type { TabId } from './types.js';

const DEBOUNCE_DELAY_MS = 500;
const BATCH_SIZE_LIMIT = 50;

export interface UseInboxDataResult {
  commands: Command[];
  actions: Action[];
  setCommands: React.Dispatch<React.SetStateAction<Command[]>>;
  setActions: React.Dispatch<React.SetStateAction<Action[]>>;
  commandsCursor: string | undefined; // @allow-undefined-type -- pagination cursor explicitly tri-state (loading/empty/has-more)
  actionsCursor: string | undefined; // @allow-undefined-type -- pagination cursor explicitly tri-state (loading/empty/has-more)
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  listenerError: string | null;
  fetchData: (showRefreshing?: boolean) => Promise<void>;
  loadMoreCommands: () => Promise<void>;
  loadMoreActions: () => Promise<void>;
  deleteCommandById: (id: string) => Promise<void>;
  archiveCommandById: (id: string) => Promise<void>;
  deletingCommandId: string | null;
  archivingCommandId: string | null;
  fetchActionById: (id: string) => Promise<Action | null>;
}

export function useInboxData(activeTab: TabId, statusFilter: ActionStatus[]): UseInboxDataResult {
  const { getAccessToken } = useAuth();
  const [commands, setCommands] = useState<Command[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [commandsCursor, setCommandsCursor] = useState<string | undefined>(undefined);
  const [actionsCursor, setActionsCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingCommandId, setDeletingCommandId] = useState<string | null>(null);
  const [archivingCommandId, setArchivingCommandId] = useState<string | null>(null);

  const { changedActionIds, error: actionListenerError, clearChangedIds: clearActionChangedIds } =
    useActionChanges(activeTab === 'actions');
  const { changedCommandIds, error: commandListenerError, clearChangedIds: clearCommandChangedIds } =
    useCommandChanges(activeTab === 'commands');
  const listenerError = activeTab === 'actions' ? actionListenerError : commandListenerError;

  const actionsDebounceRef = useRef<number | null>(null);
  const commandsDebounceRef = useRef<number | null>(null);

  const fetchChangedActions = useCallback(async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      const token = await getAccessToken();
      const fetched: Action[] = [];
      for (let i = 0; i < ids.length; i += BATCH_SIZE_LIMIT) {
        fetched.push(...(await batchGetActions(token, ids.slice(i, i + BATCH_SIZE_LIMIT))));
      }
      setActions((prev) => {
        const updated = [...prev];
        for (const changed of fetched) {
          const idx = updated.findIndex((a) => a.id === changed.id);
          const matches = statusFilter.length === 0 || statusFilter.includes(changed.status);
          if (idx >= 0) updated[idx] = changed;
          else if (matches) updated.unshift(changed);
        }
        return updated;
      });
      clearActionChangedIds();
    } catch { /* silent */ }
  }, [getAccessToken, clearActionChangedIds, statusFilter]);

  const fetchChangedCommands = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const response = await getCommands(token);
      setCommands(response.commands);
      setCommandsCursor(response.nextCursor);
      clearCommandChangedIds();
    } catch { /* silent */ }
  }, [getAccessToken, clearCommandChangedIds]);

  useEffect(() => {
    if (changedActionIds.length === 0) return;
    if (actionsDebounceRef.current !== null) window.clearTimeout(actionsDebounceRef.current);
    actionsDebounceRef.current = window.setTimeout(() => {
      void fetchChangedActions(changedActionIds);
    }, DEBOUNCE_DELAY_MS);
    return (): void => {
      if (actionsDebounceRef.current !== null) window.clearTimeout(actionsDebounceRef.current);
    };
  }, [changedActionIds, fetchChangedActions]);

  useEffect(() => {
    if (changedCommandIds.length === 0) return;
    if (commandsDebounceRef.current !== null) window.clearTimeout(commandsDebounceRef.current);
    commandsDebounceRef.current = window.setTimeout(() => {
      void fetchChangedCommands();
    }, DEBOUNCE_DELAY_MS);
    return (): void => {
      if (commandsDebounceRef.current !== null) window.clearTimeout(commandsDebounceRef.current);
    };
  }, [changedCommandIds, fetchChangedCommands]);

  const fetchData = useCallback(async (showRefreshing?: boolean): Promise<void> => {
    try {
      if (showRefreshing === true) setIsRefreshing(true); else setIsLoading(true);
      setError(null);
      const token = await getAccessToken();
      const opts = statusFilter.length > 0 ? { status: statusFilter } : undefined;
      const [c, a] = await Promise.all([getCommands(token), getActions(token, opts)]);
      setCommands(c.commands); setActions(a.actions);
      setCommandsCursor(c.nextCursor); setActionsCursor(a.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch inbox data');
    } finally {
      setIsLoading(false); setIsRefreshing(false);
    }
  }, [getAccessToken, statusFilter]);

  const loadMoreCommands = useCallback(async (): Promise<void> => {
    if (commandsCursor === undefined || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const r = await getCommands(token, { cursor: commandsCursor });
      setCommands((prev) => [...prev, ...r.commands]);
      setCommandsCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more commands');
    } finally { setIsLoadingMore(false); }
  }, [commandsCursor, isLoadingMore, getAccessToken]);

  const loadMoreActions = useCallback(async (): Promise<void> => {
    if (actionsCursor === undefined || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const opts: { cursor: string; status?: ActionStatus[] } = { cursor: actionsCursor };
      if (statusFilter.length > 0) opts.status = statusFilter;
      const r = await getActions(token, opts);
      setActions((prev) => [...prev, ...r.actions]);
      setActionsCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more actions');
    } finally { setIsLoadingMore(false); }
  }, [actionsCursor, isLoadingMore, getAccessToken, statusFilter]);

  const deleteCommandById = useCallback(async (commandId: string): Promise<void> => {
    try {
      setDeletingCommandId(commandId); setError(null);
      const token = await getAccessToken();
      await deleteCommand(token, commandId);
      setCommands((prev) => prev.filter((c) => c.id !== commandId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete command');
    } finally { setDeletingCommandId(null); }
  }, [getAccessToken]);

  const archiveCommandById = useCallback(async (commandId: string): Promise<void> => {
    try {
      setArchivingCommandId(commandId); setError(null);
      const token = await getAccessToken();
      const updated = await archiveCommand(token, commandId);
      setCommands((prev) => prev.map((c) => (c.id === commandId ? updated : c)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to archive command');
    } finally { setArchivingCommandId(null); }
  }, [getAccessToken]);

  const fetchActionById = useCallback(async (id: string): Promise<Action | null> => {
    try {
      const token = await getAccessToken();
      const fetched = await batchGetActions(token, [id]);
      return fetched.find((a) => a.id === id) ?? null;
    } catch {
      return null;
    }
  }, [getAccessToken]);

  return {
    commands, actions, setCommands, setActions,
    commandsCursor, actionsCursor,
    isLoading, isLoadingMore, isRefreshing,
    error, setError, listenerError,
    fetchData, loadMoreCommands, loadMoreActions,
    deleteCommandById, archiveCommandById,
    deletingCommandId, archivingCommandId,
    fetchActionById,
  };
}
