import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context';
import { LogOut, ChevronDown, User } from 'lucide-react';

export function Header(): React.JSX.Element {
  const { user, logout } = useAuth();
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
    <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
      <div className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt="PraxOS Logo"
          className="h-8 w-8"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <h1 className="text-xl font-bold text-slate-900">
          Prax<span className="text-amber-500">OS</span>
        </h1>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => {
            setIsMenuOpen(!isMenuOpen);
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
        >
          {userPicture !== undefined && userPicture !== '' ? (
            <img src={userPicture} alt="" className="h-6 w-6 rounded-full" />
          ) : (
            <User className="h-5 w-5 text-slate-400" />
          )}
          <span className="max-w-50 truncate">{userEmail}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isMenuOpen ? (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
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
    </header>
  );
}
