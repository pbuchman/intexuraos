import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useSyncQueue, useTheme } from '@/context';
import { signOutFirebase } from '@/services/firebase';
import { usePWA } from '@/context/pwa-context';
import { useWorkersStatus } from '@/hooks';
import { ChevronDown, LogOut, Moon, Sun, User, RefreshCw, RotateCcw, Server } from 'lucide-react';
import { VersionInfoModal } from './VersionInfoModal.js';
import type { WorkerStatus } from '@/types';

/**
 * Get display text and color for worker status.
 */
const getStatusDisplay = (worker: WorkerStatus): {
  text: string;
  color: string;
  icon: string;
} => {
  if (worker.status === 'healthy') {
    if (worker.details?.available !== undefined && worker.details.capacity !== undefined) {
      return {
        text: `Online (${String(worker.details.available)}/${String(worker.details.capacity)})`,
        color: 'bg-green-500',
        icon: '🟢',
      };
    }
    return {
      text: 'Online',
      color: 'bg-green-500',
      icon: '🟢',
    };
  }

  if (worker.status === 'orchestrator-unreachable') {
    if (worker.details?.reason === 'timeout') {
      return {
        text: 'Orchestrator not responding',
        color: 'bg-red-500',
        icon: '🔴',
      };
    }
    return {
      text: `Orchestrator error ${worker.details?.code ?? ''}`,
      color: 'bg-red-500',
      icon: '🔴',
    };
  }

  if (worker.status === 'tunnel-down') {
    return {
      text: 'Tunnel offline',
      color: 'bg-red-500',
      icon: '🔴',
    };
  }

  return {
    text: 'Unknown status',
    color: 'bg-gray-400',
    icon: '⚪',
  };
};

export function Header(): React.JSX.Element {
  const { user, logout, isAuthenticated } = useAuth();
  const { pendingCount, isSyncing, isOnline, authFailed } = useSyncQueue();
  const { isInstalled } = usePWA();
  const { status: workersStatus, refreshStatus: refreshWorkersStatus, refreshing: isWorkersRefreshing } = useWorkersStatus();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWorkersOpen, setIsWorkersOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const workersRef = useRef<HTMLDivElement>(null);

  const handleForceRefresh = (): void => {
    setIsRefreshing(true);
    setIsMenuOpen(false);

    // Clear service worker caches and reload
    if ('caches' in window) {
      void caches.keys().then((names) => {
        for (const name of names) {
          void caches.delete(name);
        }
      });
    }

    // Unregister service worker and reload
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsWorkersOpen(false); // Also close workers submenu when menu closes
      }
      if (workersRef.current !== null && !workersRef.current.contains(event.target as Node)) {
        setIsWorkersOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const userName = user?.name ?? user?.email ?? 'User';
  const userPicture = user?.picture;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:pl-3 md:pr-6">
      {/* Logo - aligned with sidebar menu icons, with left padding on mobile for menu button */}
      <div className="flex items-center gap-3 pl-12 md:pl-0">
        <button
          onClick={(): void => {
            setIsVersionModalOpen(true);
          }}
          className="flex items-center gap-2 rounded-md px-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {/* Light theme: dark logo */}
          <img
            src="/branding/logo-primary-dark.png"
            alt="IntexuraOS"
            className="h-10 w-auto shrink-0 object-contain block dark:hidden"
            onError={(e): void => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {/* Dark theme: light logo */}
          <img
            src="/branding/logo-primary-light.png"
            alt="IntexuraOS"
            className="h-10 w-auto shrink-0 object-contain hidden dark:block"
            onError={(e): void => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span className="hidden self-end pb-[calc(var(--spacing)*1.2)] text-[10px] font-normal text-slate-400 md:inline md:text-xs">
            ver. {import.meta.env.INTEXURAOS_BUILD_VERSION}
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {/* Worker Status Indicator - only shown in non-PWA mode */}
        {isAuthenticated && workersStatus !== null && !isInstalled && (
          <div className="relative" data-testid="workers-status-header" ref={workersRef}>
            <button
              onClick={(): void => {
                setIsWorkersOpen(!isWorkersOpen);
              }}
              className="flex items-center gap-1 rounded-lg p-2 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
              title="Worker status"
            >
              <Server className="h-4 w-4 text-slate-500" />
              <span
                className={`h-2 w-2 rounded-full ${
                  workersStatus.workers.length === 0
                    ? 'bg-gray-400'
                    : workersStatus.workers.some((w) => w.healthy)
                      ? 'bg-green-500'
                      : 'bg-red-500'
                }`}
              />
            </button>

            {isWorkersOpen ? (
              <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-slate-200 bg-white py-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between px-4 py-1">
                  <div className="text-xs font-medium uppercase text-slate-400">
                    Code Workers
                  </div>
                  {workersStatus.workers.length > 0 && (
                    <button
                      onClick={(): void => {
                        void refreshWorkersStatus();
                      }}
                      disabled={isWorkersRefreshing}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed dark:text-blue-400 dark:hover:text-blue-300"
                      title="Refresh status"
                    >
                      <RefreshCw className={`h-3 w-3 ${isWorkersRefreshing ? 'animate-spin' : ''}`} />
                      {isWorkersRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                  )}
                </div>

                {workersStatus.workers.length === 0 ? (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <span className="text-lg">⚪</span>
                      <span>No workers configured</span>
                    </div>
                    <Link
                      to="/settings/workers"
                      onClick={(): void => {
                        setIsWorkersOpen(false);
                      }}
                      className="mt-2 block text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Configure in Settings →
                    </Link>
                  </div>
                ) : (
                  <>
                    {workersStatus.workers.map((worker) => {
                      const display = getStatusDisplay(worker);
                      return (
                        <div
                          key={worker.name}
                          className="flex items-center justify-between px-4 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{display.icon}</span>
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {worker.name}
                              </span>
                              {worker.stale && (
                                <span className="text-xs text-slate-400">
                                  (stale)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {display.text}
                          </div>
                        </div>
                      );
                    })}

                    <div className="mt-1 border-t border-slate-100 px-4 py-2 dark:border-slate-700">
                      <Link
                        to="/code-tasks"
                        onClick={(): void => {
                          setIsWorkersOpen(false);
                        }}
                        className="block text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        View Code Tasks →
                      </Link>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {pendingCount > 0 && (
          <Link
            to="/settings/share-history"
            className="flex items-center justify-center rounded-lg p-2 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            title={
              !isOnline
                ? 'Offline - click to view history'
                : authFailed
                  ? 'Sign in to sync - click to view history'
                  : `${String(pendingCount)} pending - click to view history`
            }
          >
            <RefreshCw
              className={`h-4 w-4 ${
                !isOnline || authFailed
                  ? 'text-slate-400'
                  : isSyncing
                    ? 'text-amber-500 animate-spin'
                    : 'text-amber-500 animate-pulse'
              }`}
            />
          </Link>
        )}

        <div className="relative" ref={menuRef}>
          <button
            onClick={(): void => {
              setIsMenuOpen(!isMenuOpen);
            }}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 md:px-3"
          >
            {userPicture !== undefined && userPicture !== '' ? (
              <img src={userPicture} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <User className="h-5 w-5 text-slate-400" />
            )}
            <span className="hidden max-w-32 truncate sm:inline md:max-w-48">{userName}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isMenuOpen ? (
            <div className={`absolute right-0 top-full mt-1 ${isInstalled && workersStatus !== null ? 'w-72' : 'w-48'} rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800`}>
              <div className="border-b border-slate-100 px-4 py-2 sm:hidden dark:border-slate-700">
                <span className="text-sm text-slate-600 dark:text-slate-300">{userName}</span>
              </div>

              {/* Workers status menu item - only shown in PWA mode */}
              {isInstalled && isAuthenticated && workersStatus !== null && (
                <div data-testid="workers-status-menu">
                  <button
                    onClick={(): void => {
                      setIsWorkersOpen(!isWorkersOpen);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Server className="h-4 w-4 text-slate-500" />
                    <span>Workers</span>
                    <span
                      className={`ml-auto h-2 w-2 rounded-full ${
                        workersStatus.workers.length === 0
                          ? 'bg-gray-400'
                          : workersStatus.workers.some((w) => w.healthy)
                            ? 'bg-green-500'
                            : 'bg-red-500'
                      }`}
                    />
                  </button>

                  {isWorkersOpen && (
                    <div className="border-t border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-between px-4 py-1">
                        <div className="text-xs font-medium uppercase text-slate-400">
                          Code Workers
                        </div>
                        {workersStatus.workers.length > 0 && (
                          <button
                            onClick={(): void => {
                              void refreshWorkersStatus();
                            }}
                            disabled={isWorkersRefreshing}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed dark:text-blue-400 dark:hover:text-blue-300"
                            title="Refresh status"
                          >
                            <RefreshCw className={`h-3 w-3 ${isWorkersRefreshing ? 'animate-spin' : ''}`} />
                            {isWorkersRefreshing ? 'Refreshing...' : 'Refresh'}
                          </button>
                        )}
                      </div>

                      {workersStatus.workers.length === 0 ? (
                        <div className="px-4 py-2">
                          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <span className="text-base">⚪</span>
                            <span>No workers configured</span>
                          </div>
                          <Link
                            to="/settings/workers"
                            onClick={(): void => {
                              setIsMenuOpen(false);
                              setIsWorkersOpen(false);
                            }}
                            className="mt-1 block text-sm text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Configure in Settings →
                          </Link>
                        </div>
                      ) : (
                        <>
                          {workersStatus.workers.map((worker) => {
                            const display = getStatusDisplay(worker);
                            return (
                              <div
                                key={worker.name}
                                className="flex items-center justify-between px-4 py-1.5 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-base">{display.icon}</span>
                                  <span className="font-medium text-slate-700 dark:text-slate-200">
                                    {worker.name}
                                  </span>
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {display.text}
                                </span>
                              </div>
                            );
                          })}

                          <div className="border-t border-slate-100 px-4 py-1.5 dark:border-slate-700">
                            <Link
                              to="/code-tasks"
                              onClick={(): void => {
                                setIsMenuOpen(false);
                                setIsWorkersOpen(false);
                              }}
                              className="block text-sm text-blue-600 hover:underline dark:text-blue-400"
                            >
                              View Code Tasks →
                            </Link>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isInstalled && (
                <button
                  onClick={handleForceRefresh}
                  disabled={isRefreshing}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  {isRefreshing ? 'Refreshing...' : 'Force Refresh'}
                </button>
              )}
              <button
                onClick={(): void => {
                  void signOutFirebase().catch(() => { /* best-effort */ });
                  logout();
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isVersionModalOpen && (
        <VersionInfoModal
          onClose={(): void => {
            setIsVersionModalOpen(false);
          }}
        />
      )}
    </header>
  );
}
