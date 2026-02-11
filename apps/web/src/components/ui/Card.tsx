import type { ReactNode } from 'react';

type CardVariant = 'default' | 'success' | 'warning' | 'error';

interface CardProps {
  title?: ReactNode;
  variant?: CardVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<CardVariant, string> = {
  default: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
  success: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30',
  warning: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30',
  error: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30',
};

export function Card({
  title,
  variant = 'default',
  children,
  className = '',
}: CardProps): React.JSX.Element {
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${variantStyles[variant]} ${className}`}>
      {title !== null && title !== undefined ? (
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      ) : null}
      {children}
    </div>
  );
}
