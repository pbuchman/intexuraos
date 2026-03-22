import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context';
import { listBranches, listPrs, listWatches, createWatch, cancelWatch } from '@/services/mergeQueueApi';
import type { MergeQueueBranch, MergeQueuePr, MergeQueueWatch } from '@/types';

const WATCH_POLL_MS = 30000;
const PRS_POLL_MS = 60000;

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

  const selectedBranchRef = useRef(selectedBranch);
  selectedBranchRef.current = selectedBranch;

  const watchesRef = useRef(watches);
  watchesRef.current = watches;

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
      setError(err instanceof Error ? err.message : 'Failed to load merge queue data');
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
        setPrsError(err instanceof Error ? err.message : 'Failed to load PRs');
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
        await createWatch(token, owner, repo, branch);
      }

      // Refetch watches immediately
      const res = await listWatches(token, owner, repo);
      setWatches(res.watches);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Failed to toggle auto-merge');
    } finally {
      setIsToggling(false);
    }
  }, [getAccessToken, owner, repo]);

  const handleToggleWatch = useCallback((): void => {
    void doToggleWatch();
  }, [doToggleWatch]);

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
  };
}
