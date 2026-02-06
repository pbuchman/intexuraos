interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  color?: 'default' | 'error' | 'warn' | 'info' | 'debug';
}

const colorClasses = {
  default: {
    active: 'bg-amber-500/20 text-amber-400 border-amber-500/50',
    inactive: 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600',
  },
  error: {
    active: 'bg-red-500/20 text-red-400 border-red-500/50',
    inactive: 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600',
  },
  warn: {
    active: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    inactive: 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600',
  },
  info: {
    active: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    inactive: 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600',
  },
  debug: {
    active: 'bg-slate-500/20 text-slate-400 border-slate-500/50',
    inactive: 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600',
  },
};

export function FilterChip({
  label,
  isActive,
  onClick,
  color = 'default',
}: FilterChipProps): React.JSX.Element {
  const classes = colorClasses[color];
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        isActive ? classes.active : classes.inactive
      }`}
    >
      {label}
    </button>
  );
}
