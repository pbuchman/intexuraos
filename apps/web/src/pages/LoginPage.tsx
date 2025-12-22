import { useAuth } from '@/context';
import { Button } from '@/components';

export function LoginPage(): React.JSX.Element {
  const { login, isLoading } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900">
            Prax<span className="text-amber-500">OS</span>
          </h1>
          <p className="mt-2 text-slate-600">Personal Operating System</p>
        </div>

        <div className="space-y-4">
          <Button onClick={login} isLoading={isLoading} className="w-full" size="lg">
            Sign in with Google
          </Button>

          <p className="text-center text-sm text-slate-500">
            Sign in to manage your integrations and view your dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
