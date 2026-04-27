import React from 'react';

export function StatBlock({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="text-center">
      <div className="text-4xl font-extrabold tracking-tight text-neutral-900 md:text-5xl">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
    </div>
  );
}
