import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({
  label,
  error,
  id,
  className = '',
  ...props
}: InputProps): React.JSX.Element {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <input
        id={inputId}
        className={`block w-full rounded-lg border px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-400 ${
          error !== undefined && error !== '' ? 'border-red-500 dark:border-red-400' : 'border-slate-300 dark:border-slate-600'
        } ${className}`}
        {...props}
      />
      {error !== undefined && error !== '' ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
