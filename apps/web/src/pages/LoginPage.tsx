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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            <span className="text-cyan-500">Intexura</span>
            <span className="text-slate-900">OS</span>
          </h1>
          <p className="mt-2 text-slate-600">Personal Operating System</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-center text-sm text-slate-500">Redirecting to sign in...</p>
        </div>
      </div>
    </div>
  );
}
