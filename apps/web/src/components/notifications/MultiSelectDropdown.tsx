import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel: string;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  allLabel,
}: MultiSelectDropdownProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOption = (option: string): void => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const displayText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${String(selected.length)} selected`;

  return (
    <div className="relative flex flex-col gap-1">
      <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
      <button
        type="button"
        onClick={(): void => {
          setIsOpen(!isOpen);
        }}
        className="flex min-w-[140px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:border-slate-500"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(): void => {
              setIsOpen(false);
            }}
          />
          <div className="absolute top-full z-20 mt-1 max-h-60 w-full min-w-[200px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
            {options.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={(): void => {
                    toggleOption(option);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {isSelected ? <Check className="h-3 w-3" /> : null}
                  </div>
                  <span className="truncate text-sm text-slate-700 dark:text-slate-200">{option}</span>
                </button>
              );
            })}
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No options available</div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
