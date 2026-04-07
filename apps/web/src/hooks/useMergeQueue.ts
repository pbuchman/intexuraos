import { useState, useEffect, useCallback, useRef } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listBranches, listPrs, listWatches, createWatch, cancelWatch, updateExclusions } from '@/services/mergeQueueApi';
import type { MergeQueueBranch, MergeQueuePr, MergeQueueWatch } from '@/types';

const WATCH_POLL_MS = 30000;
const PRS_POLL_MS = 60000;
const EXCLUSION_ERROR_CLEAR_MS = 3000;
const SYNC_COOLDOWN_MS = 2000;

interface UseMergeQueueResult {
  branches: MergeQueueBranch[];
  selectedBranch: string | null;
  setSelectedBranch: (branch: string) => void;
  prs: MergeQueuePr[];
  watches: MergeQueueWatch[];
  loading: boolean;
  error: string | null;
  prsLoading: boolean;
  prsError: string | null;
  isToggling: boolean;
  toggleError: string | null;
  fetchInitialData: () => Promise<void>;
  handleToggleWatch: () => void;
  excludedPrNumbers: Set<number>;
  exclusionError: string | null;
  handleToggleExclusion: (prNumber: number) => void;
  handleSelectAll: () => void;
  handleDeselectAll: (eligiblePrNumbers: number[]) => void;
}

export function useMergeQueue(owner: string, repo: string): UseMergeQueueResult {
  const { getAccessToken } = useAuth();

  const [branches, setBranches] = useState<MergeQueueBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [prs, setPrs] = useState<MergeQueuePr[]>([]);
  const [watches, setWatches] = useState<MergeQueueWatch[]>([]);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [excludedPrNumbers, setExcludedPrNumbers] = useState<Set<number>>(new Set());
  const [exclusionError, setExclusionError] = useState<string | null>(null);
  const [exclusionInFlight, setExclusionInFlight] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(false);

  const selectedBranchRef = useRef(selectedBranch);
  selectedBranchRef.current = selectedBranch;

  const watchesRef = useRef(watches);
  watchesRef.current = watches;

  const excludedPrNumbersRef = useRef(excludedPrNumbers);
  excludedPrNumbersRef.current = excludedPrNumbers;

  const exclusionInFlightRef = useRef(false);
  exclusionInFlightRef.current = exclusionInFlight;

  // Fetch branches and watches on mount
  const fetchInitialData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      const [branchesRes, watchesRes] = await Promise.all([
        listBranches(token, owner, repo),
        listWatches(token, owner, repo),
      ]);
      setBranches(branchesRes.branches);
      setWatches(watchesRes.watches);

      // Auto-select development branch if present, otherwise branch with most PRs
      if (branchesRes.branches.length > 0) {
        const dev = branchesRes.branches.find((b) => b.name === 'development');
        if (dev !== undefined) {
          setSelectedBranch(dev.name);
        } else {
          const sorted = [...branchesRes.branches].sort((a, b) => b.openPrCount - a.openPrCount);
          const best = sorted[0];
          if (best !== undefined) {
            setSelectedBranch(best.name);
          }
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load merge queue data'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, owner, repo]);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  // Fetch PRs when branch changes
  const fetchPrs = useCallback(async (branch: string): Promise<void> => {
    try {
      setPrsLoading(true);
      setPrsError(null);
      const token = await getAccessToken();
      const res = await listPrs(token, owner, repo, branch);
      if (selectedBranchRef.current === branch) {
        setPrs(res.pullRequests);
      }
    } catch (err) {
      if (selectedBranchRef.current === branch) {
        setPrsError(getErrorMessage(err, 'Failed to load PRs'));
      }
    } finally {
      setPrsLoading(false);
    }
  }, [getAccessToken, owner, repo]);

  useEffect(() => {
    if (selectedBranch !== null) {
      setPrs([]);
      void fetchPrs(selectedBranch);
    }
  }, [selectedBranch, fetchPrs]);

  // Poll watches every 30s (pause when tab hidden)
  useEffect(() => {
    const poll = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      try {
        const token = await getAccessToken();
        const res = await listWatches(token, owner, repo);
        setWatches(res.watches);
      } catch {
        // Silently fail polling
      }
    };

    const intervalId = setInterval(() => { void poll(); }, WATCH_POLL_MS);
    return (): void => {
      clearInterval(intervalId);
    };
  }, [getAccessToken, owner, repo]);

  // Poll PRs every 60s (pause when tab hidden)
  useEffect(() => {
    const poll = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      const branch = selectedBranchRef.current;
      if (branch === null) return;
      try {
        const token = await getAccessToken();
        const res = await listPrs(token, owner, repo, branch);
        if (selectedBranchRef.current === branch) {
          setPrs(res.pullRequests);
          setPrsError(null);
        }
      } catch {
        // Silently fail polling — initial fetchPrs error banner clears on next successful poll
      }
    };

    const intervalId = setInterval(() => { void poll(); }, PRS_POLL_MS);
    return (): void => {
      clearInterval(intervalId);
    };
  }, [getAccessToken, owner, repo]);

  // Clear exclusions when branch changes (handles branch switching)
  useEffect(() => {
    setExcludedPrNumbers(new Set());
  }, [selectedBranch]);

  // Sync exclusion state from active watch (skips while API call is in-flight or during cooldown)
  // Does NOT clear when no active watch exists — preserves pre-watch exclusions set by the user
  useEffect(() => {
    if (exclusionInFlight || syncCooldown) return;
    const activeWatch = watches.find(
      (w) => w.baseBranch === selectedBranch && w.status === 'active'
    );
    if (activeWatch !== undefined) {
      setExcludedPrNumbers(new Set(activeWatch.excludedPrNumbers));
    }
  }, [watches, selectedBranch, exclusionInFlight, syncCooldown]);

  // Toggle watch handler — reads watches via ref to avoid re-creation on every poll
  const doToggleWatch = useCallback(async (): Promise<void> => {
    const branch = selectedBranchRef.current;
    if (branch === null) return;
    setIsToggling(true);
    setToggleError(null);
    try {
      const token = await getAccessToken();
      const activeWatch = watchesRef.current.find(
        (w) => w.baseBranch === branch && w.status === 'active'
      );

      if (activeWatch !== undefined) {
        await cancelWatch(token, activeWatch.watchId);
      } else {
        await createWatch(token, owner, repo, branch, [...excludedPrNumbersRef.current]);
      }

      // Refetch watches immediately
      const res = await listWatches(token, owner, repo);
      setWatches(res.watches);
    } catch (err) {
      setToggleError(getErrorMessage(err, 'Failed to toggle auto-merge'));
    } finally {
      setIsToggling(false);
    }
  }, [getAccessToken, owner, repo]);

  const handleToggleWatch = useCallback((): void => {
    void doToggleWatch();
  }, [doToggleWatch]);

  // Timer refs for cleanup on unmount
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => (): void => {
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    if (cooldownTimerRef.current !== null) clearTimeout(cooldownTimerRef.current);
  }, []);

  // Shared helper: apply an exclusion update with optimistic state and API persistence
  const applyExclusionUpdate = useCallback((next: Set<number>): void => {
    if (exclusionInFlightRef.current) return;
    setExclusionError(null);
    const prev = excludedPrNumbersRef.current;
    setExcludedPrNumbers(next);

    const activeWatch = watchesRef.current.find(
      (w) => w.baseBranch === selectedBranchRef.current && w.status === 'active'
    );
    if (activeWatch !== undefined) {
      setExclusionInFlight(true);
      void (async (): Promise<void> => {
        try {
          const token = await getAccessToken();
          await updateExclusions(token, activeWatch.watchId, [...next]);
        } catch (err) {
          setExcludedPrNumbers(prev);
          setExclusionError(getErrorMessage(err, 'Failed to update exclusions'));
          if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
          errorTimerRef.current = setTimeout(() => { setExclusionError(null); }, EXCLUSION_ERROR_CLEAR_MS);
        } finally {
          setExclusionInFlight(false);
          if (cooldownTimerRef.current !== null) clearTimeout(cooldownTimerRef.current);
          setSyncCooldown(true);
          cooldownTimerRef.current = setTimeout(() => { setSyncCooldown(false); }, SYNC_COOLDOWN_MS);
        }
      })();
    }
  }, [getAccessToken]);

  const handleToggleExclusion = useCallback((prNumber: number): void => {
    const next = new Set(excludedPrNumbersRef.current);
    if (next.has(prNumber)) {
      next.delete(prNumber);
    } else {
      next.add(prNumber);
    }
    applyExclusionUpdate(next);
  }, [applyExclusionUpdate]);

  const handleSelectAll = useCallback((): void => {
    applyExclusionUpdate(new Set<number>());
  }, [applyExclusionUpdate]);

  const handleDeselectAll = useCallback((eligiblePrNumbers: number[]): void => {
    applyExclusionUpdate(new Set(eligiblePrNumbers));
  }, [applyExclusionUpdate]);

  return {
    branches,
    selectedBranch,
    setSelectedBranch,
    prs,
    watches,
    loading,
    error,
    prsLoading,
    prsError,
    isToggling,
    toggleError,
    fetchInitialData,
    handleToggleWatch,
    excludedPrNumbers,
    exclusionError,
    handleToggleExclusion,
    handleSelectAll,
    handleDeselectAll,
  };
}
