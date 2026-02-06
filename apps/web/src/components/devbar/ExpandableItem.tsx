import { useState, useCallback } from 'react';

interface ExpandableItemProps {
  children: React.ReactNode;
  expandedContent: React.ReactNode;
  className?: string;
}

export function ExpandableItem({
  children,
  expandedContent,
  className = '',
}: ExpandableItemProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className={className}>
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center gap-1 text-left hover:bg-slate-800/50 transition-colors"
      >
        <svg
          className={`h-2.5 w-2.5 flex-shrink-0 text-slate-500 transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {children}
      </button>
      {isExpanded && (
        <div className="ml-4 mt-0.5 rounded border border-slate-700 bg-slate-900 p-1.5 text-xs">
          {expandedContent}
        </div>
      )}
    </div>
  );
}
