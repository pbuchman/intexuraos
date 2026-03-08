import { useState, useEffect, useRef, useMemo } from 'react';
import { Check, Search, X, Loader2 } from 'lucide-react';
import { Button } from './ui/Button.js';
import type { LinearIssueOption, GroupedLinearIssueOptions } from '@/hooks/useLinearIssueOptions';

interface LinearIssueSelectorModalProps {
  isOpen: boolean;
  groupedOptions: GroupedLinearIssueOptions;
  loading: boolean;
  error: string | null;
  selected: LinearIssueOption | null;
  onSelect: (option: LinearIssueOption) => void;
  onClose: () => void;
}

const STATE_GROUP_ORDER = ['in_progress', 'in_review', 'todo', 'backlog', 'to_test'] as const;

const STATE_GROUP_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  in_review: 'In Review',
  todo: 'Todo',
  backlog: 'Backlog',
  to_test: 'To Test',
};

const STATE_GROUP_DOT_COLORS: Record<string, string> = {
  in_progress: 'bg-blue-500',
  in_review: 'bg-purple-500',
  todo: 'bg-slate-500',
  backlog: 'bg-gray-400',
  to_test: 'bg-amber-500',
};

const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-slate-300 dark:bg-slate-600',
  1: 'bg-red-500',
  2: 'bg-orange-500',
  3: 'bg-blue-500',
  4: 'bg-slate-400',
};

export function LinearIssueSelectorModal({
  isOpen,
  groupedOptions,
  loading,
  error,
  selected,
  onSelect,
  onClose,
}: LinearIssueSelectorModalProps): React.JSX.Element | null {
  const [search, setSearch] = useState('');
  const [pendingSelection, setPendingSelection] = useState<LinearIssueOption | null>(selected);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPendingSelection(selected);
      setSearch('');
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen, selected]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const filteredGroups = useMemo((): { key: string; label: string; dotColor: string; issues: LinearIssueOption[] }[] => {
    const lowerSearch = search.toLowerCase();
    const result: { key: string; label: string; dotColor: string; issues: LinearIssueOption[] }[] = [];

    for (const key of STATE_GROUP_ORDER) {
      const issues = groupedOptions[key];
      if (issues === undefined || issues.length === 0) continue;

      const filtered = search.length === 0
        ? issues
        : issues.filter(
            (issue) =>
              issue.identifier.toLowerCase().includes(lowerSearch) ||
              issue.title.toLowerCase().includes(lowerSearch)
          );

      if (filtered.length > 0) {
        result.push({
          key,
          label: STATE_GROUP_LABELS[key] ?? key,
          dotColor: STATE_GROUP_DOT_COLORS[key] ?? 'bg-slate-400',
          issues: filtered,
        });
      }
    }

    return result;
  }, [groupedOptions, search]);

  const totalFilteredCount = filteredGroups.reduce((sum, g) => sum + g.issues.length, 0);

  if (!isOpen) return null;

  const handleSelect = (): void => {
    if (pendingSelection !== null) {
      onSelect(pendingSelection);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Select Linear Issue
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e): void => {
                setSearch(e.target.value);
              }}
              placeholder="Search by ID or title..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading issues...</p>
            </div>
          ) : error !== null ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          ) : totalFilteredCount === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {search.length > 0 ? 'No matching issues' : 'No issues available'}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${group.dotColor}`} />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {group.label}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      ({String(group.issues.length)})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.issues.map((issue) => {
                      const isSelected = pendingSelection?.identifier === issue.identifier;
                      const isSubtask = issue.parentId !== null;
                      return (
                        <button
                          key={issue.identifier}
                          type="button"
                          onClick={(): void => {
                            setPendingSelection(issue);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isSelected
                              ? 'bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/30 dark:ring-blue-700'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                          } ${isSubtask ? 'ml-4 pl-2' : ''}`}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={`h-1.5 w-3 rounded-full ${PRIORITY_COLORS[issue.priority] ?? 'bg-slate-300'}`}
                              title={`Priority ${String(issue.priority)}`}
                            />
                          </div>
                          <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
                            {issue.identifier}
                          </span>
                          <span className="flex-1 truncate text-slate-700 dark:text-slate-200">
                            {issue.title}
                          </span>
                          {isSubtask && (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                              subtask
                            </span>
                          )}
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSelect}
            disabled={pendingSelection === null}
          >
            Select
          </Button>
        </div>
      </div>
    </div>
  );
}
