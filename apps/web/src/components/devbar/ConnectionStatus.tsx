interface ConnectionStatusProps {
  isConnected: boolean;
  label?: string;
}

export function ConnectionStatus({ isConnected, label }: ConnectionStatusProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${
          isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
        }`}
      />
      {label !== undefined && (
        <span className={isConnected ? 'text-emerald-400' : 'text-red-400'}>{label}</span>
      )}
    </div>
  );
}
