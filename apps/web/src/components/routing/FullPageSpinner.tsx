import type { JSX } from 'react';

export function FullPageSpinner(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-screen items-center justify-center bg-slate-50"
    >
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  );
}
