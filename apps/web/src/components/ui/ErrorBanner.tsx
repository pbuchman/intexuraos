interface ErrorBannerProps {
  message: string | null;
  className?: string;
}

export function ErrorBanner({ message, className = '' }: ErrorBannerProps): React.JSX.Element | null {
  if (message === null || message === '') return null;
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400 ${className}`}>
      {message}
    </div>
  );
}
