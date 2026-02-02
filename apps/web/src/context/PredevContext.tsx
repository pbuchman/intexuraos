import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface PredevState {
  locked: boolean;
  branch: string;
  status: string;
}

interface PredevContextValue {
  isPredevMode: boolean;
  branchLocked: boolean;
  currentBranch: string;
  currentStatus: string;
  toggleLock: () => Promise<void>;
  isLoading: boolean;
}

const PredevContext = createContext<PredevContextValue | null>(null);

function isPredevModeEnabled(): boolean {
  return import.meta.env['INTEXURAOS_PREDEV_MODE'] === 'true';
}

interface PredevProviderProps {
  children: ReactNode;
}

export function PredevProvider({ children }: PredevProviderProps): React.JSX.Element {
  const isPredevMode = isPredevModeEnabled();
  const [state, setState] = useState<PredevState>({
    locked: false,
    branch: 'unknown',
    status: 'unknown',
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchState = useCallback(async (): Promise<void> => {
    if (!isPredevMode) return;

    try {
      const response = await fetch('/internal/branch-lock', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = (await response.json()) as PredevState;
        setState(data);
      }
    } catch {
      // Silently fail - predev endpoint may not be available
    }
  }, [isPredevMode]);

  const toggleLock = useCallback(async (): Promise<void> => {
    if (!isPredevMode) return;

    setIsLoading(true);
    try {
      const response = await fetch('/internal/branch-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !state.locked }),
      });

      if (response.ok) {
        const data = (await response.json()) as PredevState;
        setState(data);
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [isPredevMode, state.locked]);

  useEffect(() => {
    if (!isPredevMode) return;

    void fetchState();

    const interval = setInterval(() => {
      void fetchState();
    }, 5000);

    return (): void => {
      clearInterval(interval);
    };
  }, [isPredevMode, fetchState]);

  return (
    <PredevContext.Provider
      value={{
        isPredevMode,
        branchLocked: state.locked,
        currentBranch: state.branch,
        currentStatus: state.status,
        toggleLock,
        isLoading,
      }}
    >
      {children}
    </PredevContext.Provider>
  );
}

export function usePredev(): PredevContextValue {
  const context = useContext(PredevContext);
  if (context === null) {
    throw new Error('usePredev must be used within a PredevProvider');
  }
  return context;
}
