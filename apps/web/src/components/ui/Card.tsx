import type { ReactNode } from 'react';

type CardVariant = 'default' | 'success' | 'warning' | 'error';

interface CardProps {
  title?: string;
  variant?: CardVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<CardVariant, string> = {
  default: 'border-slate-200 bg-white',
  success: 'border-green-200 bg-green-50',
  warning: 'border-amber-200 bg-amber-50',
  error: 'border-red-200 bg-red-50',
};

export function Card({
  title,
  variant = 'default',
  children,
  className = '',
}: CardProps): React.JSX.Element {
  return (
    <div className={`rounded-xl border p-6 shadow-sm ${variantStyles[variant]} ${className}`}>
      {title !== undefined && title !== '' ? (
        <h3 className="mb-4 text-lg font-semibold text-slate-900">{title}</h3>
      ) : null}
      {children}
    </div>
  );
}
