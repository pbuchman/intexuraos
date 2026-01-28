import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context';

export function LoginPage(): React.JSX.Element {
  const { login, isLoading, isAuthenticated } = useAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !hasRedirected.current) {
      hasRedirected.current = true;
      login();
    }
  }, [isLoading, isAuthenticated, login]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500">Redirecting...</p>
      </div>
    </div>
  );
}
