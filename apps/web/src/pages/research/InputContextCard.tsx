import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components';

interface InputContextCardProps {
  inputContexts: string[];
  maxInputContexts: number;
  maxContextLength: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  submitting: boolean;
  savingDraft: boolean;
}

export function InputContextCard(props: InputContextCardProps): React.JSX.Element {
  const {
    inputContexts,
    maxInputContexts,
    maxContextLength,
    onAdd,
    onRemove,
    onUpdate,
    submitting,
    savingDraft,
  } = props;

  return (
    <Card title="Input Context (Optional)">
      <p className="text-sm text-slate-500 mb-4 dark:text-slate-400">
        Add your own reference materials to include in the research synthesis
      </p>
      <div className="space-y-4">
        {inputContexts.map((ctx, idx) => (
          <div key={idx} className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Context {String(idx + 1)}
              </span>
              <button
                type="button"
                onClick={(): void => {
                  onRemove(idx);
                }}
                disabled={submitting || savingDraft}
                className="p-1 text-slate-400 hover:text-red-600 transition-colors dark:hover:text-red-400"
                title="Remove context"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={ctx}
              onChange={(e): void => {
                onUpdate(idx, e.target.value);
              }}
              placeholder="Paste your reference content here..."
              className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[100px] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
              maxLength={maxContextLength}
              disabled={submitting || savingDraft}
            />
            <div className="text-xs text-slate-400 text-right">
              {ctx.length.toLocaleString()}/{maxContextLength.toLocaleString()}
            </div>
          </div>
        ))}
        {inputContexts.length < maxInputContexts ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={submitting || savingDraft}
            className="w-full py-2 px-4 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-600 transition-colors flex items-center justify-center gap-2 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
          >
            <Plus className="h-4 w-4" />
            Add Input Context
          </button>
        ) : (
          <p className="text-sm text-slate-400 text-center">
            Maximum {String(maxInputContexts)} contexts allowed
          </p>
        )}
      </div>
    </Card>
  );
}
