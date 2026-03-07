import { useState, useEffect, useCallback } from 'react';
import type { Pm2LogEntry } from './usePm2Logs.js';
import type { PubSubEvent } from './usePubSubEvents.js';

type Tab = 'commands' | 'pubsub' | 'logs';
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface DevBarFilters {
  logLevels: LogLevel[];
  logApp: string;
  pubsubTopics: string[];
  followLogs: boolean;
  followPubSub: boolean;
}

interface DevBarState {
  isExpanded: boolean;
  activeTab: Tab;
  height: number;
  width: number;
  logs: Pm2LogEntry[];
  pubsubEvents: PubSubEvent[];
  filters: DevBarFilters;
}

const STORAGE_KEY = 'intexuraos-devbar-state';
const DEFAULT_HEIGHT = 320;
const DEFAULT_WIDTH = 800;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 600;
const MIN_WIDTH = 400;

const DEFAULT_FILTERS: DevBarFilters = {
  logLevels: ['error', 'warn', 'info'],
  logApp: 'all',
  pubsubTopics: [],
  followLogs: true,
  followPubSub: true,
};

function loadState(): Partial<DevBarState> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      return JSON.parse(stored) as Partial<DevBarState>;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveState(state: Partial<DevBarState>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function useDevBarState(): {
  isExpanded: boolean;
  setIsExpanded: (value: boolean) => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  height: number;
  setHeight: (height: number | ((prev: number) => number)) => void;
  width: number;
  setWidth: (width: number | ((prev: number) => number)) => void;
  persistedLogs: Pm2LogEntry[];
  persistLogs: (logs: Pm2LogEntry[]) => void;
  persistedPubSubEvents: PubSubEvent[];
  persistPubSubEvents: (events: PubSubEvent[]) => void;
  filters: DevBarFilters;
  setFilters: (filters: Partial<DevBarFilters>) => void;
  minHeight: number;
  maxHeight: number;
  minWidth: number;
} {
  const [isExpanded, setIsExpandedState] = useState(() => loadState().isExpanded ?? false);
  const [activeTab, setActiveTabState] = useState<Tab>(() => loadState().activeTab ?? 'commands');
  const [height, setHeightState] = useState(() => loadState().height ?? DEFAULT_HEIGHT);
  const [width, setWidthState] = useState(() => loadState().width ?? DEFAULT_WIDTH);
  const [persistedLogs, setPersistedLogs] = useState<Pm2LogEntry[]>(() => loadState().logs ?? []);
  const [persistedPubSubEvents, setPersistedPubSubEvents] = useState<PubSubEvent[]>(
    () => loadState().pubsubEvents ?? []
  );
  const [filters, setFiltersState] = useState<DevBarFilters>(
    () => loadState().filters ?? DEFAULT_FILTERS
  );

  const setIsExpanded = useCallback((value: boolean) => {
    setIsExpandedState(value);
    const current = loadState();
    saveState({ ...current, isExpanded: value });
  }, []);

  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    const current = loadState();
    saveState({ ...current, activeTab: tab });
  }, []);

  const setHeight = useCallback((newHeight: number | ((prev: number) => number)) => {
    setHeightState((prev) => {
      const value = typeof newHeight === 'function' ? newHeight(prev) : newHeight;
      const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value));
      const current = loadState();
      saveState({ ...current, height: clamped });
      return clamped;
    });
  }, []);

  const setWidth = useCallback((newWidth: number | ((prev: number) => number)) => {
    setWidthState((prev) => {
      const value = typeof newWidth === 'function' ? newWidth(prev) : newWidth;
      const maxWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const clamped = Math.min(maxWidth, Math.max(MIN_WIDTH, value));
      const current = loadState();
      saveState({ ...current, width: clamped });
      return clamped;
    });
  }, []);

  const persistLogs = useCallback((logs: Pm2LogEntry[]) => {
    const trimmed = logs.slice(-100);
    setPersistedLogs(trimmed);
    const current = loadState();
    saveState({ ...current, logs: trimmed });
  }, []);

  const persistPubSubEvents = useCallback((events: PubSubEvent[]) => {
    const trimmed = events.slice(-100);
    setPersistedPubSubEvents(trimmed);
    const current = loadState();
    saveState({ ...current, pubsubEvents: trimmed });
  }, []);

  const setFilters = useCallback((newFilters: Partial<DevBarFilters>) => {
    setFiltersState((prev) => {
      const updated = { ...prev, ...newFilters };
      const current = loadState();
      saveState({ ...current, filters: updated });
      return updated;
    });
  }, []);

  useEffect(() => {
    const stored = loadState();
    if (stored.isExpanded !== undefined) setIsExpandedState(stored.isExpanded);
    if (stored.activeTab !== undefined) setActiveTabState(stored.activeTab);
    if (stored.height !== undefined) setHeightState(stored.height);
    if (stored.width !== undefined) setWidthState(stored.width);
    if (stored.logs !== undefined) setPersistedLogs(stored.logs);
    if (stored.pubsubEvents !== undefined) setPersistedPubSubEvents(stored.pubsubEvents);
    if (stored.filters !== undefined) setFiltersState(stored.filters);
  }, []);

  return {
    isExpanded,
    setIsExpanded,
    activeTab,
    setActiveTab,
    height,
    setHeight,
    width,
    setWidth,
    persistedLogs,
    persistLogs,
    persistedPubSubEvents,
    persistPubSubEvents,
    filters,
    setFilters,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    minWidth: MIN_WIDTH,
  };
}
