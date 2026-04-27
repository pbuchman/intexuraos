interface StatusBannersProps {
  successMessage: string | null;
  error: string | null;
}

export function StatusBanners({ successMessage, error }: StatusBannersProps): React.JSX.Element {
  return (
    <>
      {successMessage !== null && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          {successMessage}
        </div>
      )}
      {error !== null && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}
    </>
  );
}
