import { useState } from 'react';
import { Check, ChevronDown, AlertCircle } from 'lucide-react';
import type { LinearIssueOption } from '@/hooks/useLinearIssueOptions';

interface LinearIssueComboboxProps {
  options: LinearIssueOption[];
  loading: boolean;
  error: string | null;
  selected: LinearIssueOption | null;
  onSelect: (option: LinearIssueOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowNone?: boolean;
}

export function LinearIssueCombobox({
  options,
  loading,
  error,
  selected,
  onSelect,
  disabled = false,
  placeholder = 'Search or select an issue...',
  allowNone = false,
}: LinearIssueComboboxProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredOptions = options.filter(
    (option) =>
      option.identifier.toLowerCase().includes(search.toLowerCase()) ||
      option.title.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = selected;
  const displayValue = selectedOption
    ? `${selectedOption.identifier}: ${selectedOption.title}`
    : placeholder;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        disabled={disabled || loading}
        className={`
          w-full rounded-lg border px-3 py-2 text-left
          flex items-center justify-between
          focus:outline-none focus:ring-2 focus:ring-blue-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-700'}
          dark:text-slate-100
        `}
      >
        <span className="truncate flex-1">{displayValue}</span>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          )}
          {error && <AlertCircle className="h-4 w-4 text-red-500" />}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </div>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setIsOpen(false);
            }}
          />
          <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg max-h-80 overflow-auto">
            <div className="p-2 border-b border-slate-200 dark:border-slate-700">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="Search by ID or title..."
                className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
                autoFocus
              />
            </div>

            {allowNone && (
              <button
                type="button"
                onClick={(): void => {
                  onSelect(null);
                  setIsOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
              >
                No issue
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400 text-center">
                {search ? 'No matching issues' : 'No issues available'}
              </div>
            ) : (
              <div className="max-h-60 overflow-auto">
                {filteredOptions.map((option) => (
                  <button
                    key={option.identifier}
                    type="button"
                    onClick={(): void => {
                      onSelect(option);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`
                      w-full text-left px-3 py-2 text-sm rounded-md flex items-start gap-2
                      hover:bg-blue-50 dark:hover:bg-slate-700
                      ${selectedOption?.identifier === option.identifier
                          ? 'bg-blue-100 dark:bg-blue-900/30'
                          : 'text-slate-700 dark:text-slate-200'
                      }
                    `}
                  >
                    <span className="flex-1">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {option.identifier}
                      </span>
                      <span className="ml-2 truncate">{option.title}</span>
                    </span>
                    {selectedOption?.identifier === option.identifier && (
                      <Check className="h-4 w-4 flex-shrink-0 text-blue-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
