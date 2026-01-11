import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useSyncQueue } from '@/context';
import { ChevronDown, LogOut, User, RefreshCw } from 'lucide-react';

export function Header(): React.JSX.Element {
  const { user, logout } = useAuth();
  const { pendingCount, isSyncing } = useSyncQueue();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
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
        <h1 className="text-xl font-bold">
          <span className="text-cyan-500">Intexura</span>
          <span className="text-slate-900">OS</span>
          <span className="ml-2 text-xs font-normal text-slate-400">
            ver. {import.meta.env.INTEXURAOS_BUILD_VERSION}
          </span>
        </h1>
      </div>

      <div className="flex items-center gap-4">
        {pendingCount > 0 && (
          <Link
            to="/settings/share-history"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-slate-100"
            title="Pending shares - click to view history"
          >
            <RefreshCw
              className={`h-4 w-4 text-amber-500 ${isSyncing ? 'animate-spin' : ''}`}
            />
            <span className="text-amber-600">{pendingCount} pending</span>
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
