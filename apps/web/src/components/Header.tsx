import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useSyncQueue } from '@/context';
import { usePWA } from '@/context/pwa-context';
import { useWorkersStatus } from '@/hooks';
import { ChevronDown, LogOut, User, RefreshCw, RotateCcw, Server } from 'lucide-react';

export function Header(): React.JSX.Element {
  const { user, logout, isAuthenticated } = useAuth();
  const { pendingCount, isSyncing, isOnline, authFailed } = useSyncQueue();
  const { isInstalled } = usePWA();
  const { status: workersStatus } = useWorkersStatus();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWorkersOpen, setIsWorkersOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const userEmail = user?.email ?? 'User';
  const userPicture = user?.picture;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm md:px-6">
      {/* Logo - with left padding on mobile to account for menu button */}
      <div className="flex items-center gap-3 pl-12 md:pl-0">
        <img
          src="/logo.png"
          alt="IntexuraOS Logo"
          className="h-8 w-8"
          onError={(e): void => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="flex flex-col md:flex-row md:items-baseline md:gap-2">
          <h1 className="text-xl font-bold">
            <span className="text-cyan-500">Intexura</span>
            <span className="text-slate-900">OS</span>
          </h1>
          <span className="text-[10px] font-normal text-slate-400 md:text-xs">
            ver. {import.meta.env.INTEXURAOS_BUILD_VERSION}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {/* Worker Status Indicator */}
        {isAuthenticated && workersStatus !== null && (
          <div className="relative" ref={workersRef}>
            <button
              onClick={(): void => {
                setIsWorkersOpen(!isWorkersOpen);
              }}
              className="flex items-center gap-1 rounded-lg p-2 text-sm transition-colors hover:bg-slate-100"
              title="Worker status"
            >
              <Server className="h-4 w-4 text-slate-500" />
              <span
                className={`h-2 w-2 rounded-full ${
                  workersStatus.mac.healthy || workersStatus.vm.healthy
                    ? 'bg-green-500'
                    : 'bg-red-500'
                }`}
              />
            </button>

            {isWorkersOpen ? (
              <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-slate-200 bg-white py-2 shadow-lg">
                <div className="px-4 py-1 text-xs font-medium uppercase text-slate-400">
                  Code Workers
                </div>

                {/* Mac Worker */}
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        workersStatus.mac.healthy ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <span className="font-medium text-slate-700">Mac</span>
                  </div>
                  <div className="text-slate-500">
                    {workersStatus.mac.healthy
                      ? `${String(workersStatus.mac.capacity)} slots`
                      : 'Offline'}
                  </div>
                </div>

                {/* VM Worker */}
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        workersStatus.vm.healthy ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <span className="font-medium text-slate-700">VM</span>
                  </div>
                  <div className="text-slate-500">
                    {workersStatus.vm.healthy
                      ? `${String(workersStatus.vm.capacity)} slots`
                      : 'Offline'}
                  </div>
                </div>

                <div className="mt-1 border-t border-slate-100 px-4 py-2">
                  <Link
                    to="/code-tasks"
                    onClick={(): void => {
                      setIsWorkersOpen(false);
                    }}
                    className="block text-sm text-blue-600 hover:underline"
                  >
                    View Code Tasks →
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {pendingCount > 0 && (
          <Link
            to="/settings/share-history"
            className="flex items-center justify-center rounded-lg p-2 text-sm transition-colors hover:bg-slate-100"
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
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 md:px-3"
          >
            {userPicture !== undefined && userPicture !== '' ? (
              <img src={userPicture} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <User className="h-5 w-5 text-slate-400" />
            )}
            <span className="hidden max-w-32 truncate sm:inline md:max-w-48">{userEmail}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isMenuOpen ? (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="border-b border-slate-100 px-4 py-2 sm:hidden">
                <span className="text-sm text-slate-600">{userEmail}</span>
              </div>
              {isInstalled && (
                <button
                  onClick={handleForceRefresh}
                  disabled={isRefreshing}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  {isRefreshing ? 'Refreshing...' : 'Force Refresh'}
                </button>
              )}
              <button
                onClick={(): void => {
                  logout();
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
