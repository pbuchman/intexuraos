interface RefreshIndicatorProps {
  show: boolean;
  message?: string;
}

export function RefreshIndicator({ show, message = 'Updating...' }: RefreshIndicatorProps): React.JSX.Element {
  if (!show) return <></>;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      <span>{message}</span>
    </div>
  );
}
