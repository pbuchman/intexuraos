import { useState, useEffect, useCallback } from 'react';
import { Loader2, Check } from 'lucide-react';
import { Layout } from '@/components';
import { useWritingConfig } from '@/hooks/useWritingConfig';
import type { WritingCategory } from '@/types';

const CATEGORIES: { key: WritingCategory; label: string }[] = [
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'general', label: 'General' },
];

function StyleSection({
  category,
  label,
  value,
  saving,
  onSave,
  onClear,
}: {
  category: WritingCategory;
  label: string;
  value: string | null;
  saving: boolean;
  onSave: (category: WritingCategory, text: string) => Promise<void>;
  onClear: (category: WritingCategory) => Promise<void>;
}): React.JSX.Element {
  const [text, setText] = useState(value ?? '');
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setText(value ?? '');
  }, [value]);

  const isDirty = text !== (value ?? '');

  const handleSave = useCallback(async (): Promise<void> => {
    await onSave(category, text);
    setShowSaved(true);
    setTimeout(() => { setShowSaved(false); }, 2000);
  }, [category, text, onSave]);

  const handleClear = useCallback(async (): Promise<void> => {
    if (!window.confirm(`Clear style instructions for ${label}?`)) return;
    await onClear(category);
  }, [category, label, onClear]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {label}
      </h3>
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
        rows={5}
        maxLength={5000}
        placeholder={`Style instructions for ${label} writing...`}
        value={text}
        onChange={(e) => { setText(e.target.value); }}
      />
      <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">
        {String(text.length)}/5000
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          disabled={saving || !isDirty || text.trim() === ''}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Save
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          disabled={saving || value === null}
          onClick={() => void handleClear()}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Clear
        </button>
        {showSaved ? (
          <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
            <Check className="h-3.5 w-3.5" />
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function HellscriptStylePage(): React.JSX.Element {
  const { config, loading, error, saving, updateStyle, clearStyle } = useWritingConfig();

  return (
    <Layout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Voice of the Damned
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure style instructions for each writing category.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : error !== null && config === null ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : (
          <div className="space-y-4">
            {error !== null ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}
            {CATEGORIES.map(({ key, label }) => (
              <StyleSection
                key={key}
                category={key}
                label={label}
                value={config?.[key] ?? null}
                saving={saving}
                onSave={updateStyle}
                onClear={clearStyle}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
