import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Layout, ErrorBanner } from '@/components';
import { useWritingSamples } from '@/hooks/useWritingSamples';
import type { WritingCategory, WritingSample } from '@/types';
import { WRITING_CATEGORIES } from '@/types';

const MAX_SAMPLES = 5;

function isValidTab(value: string | null): value is WritingCategory {
  return value !== null && WRITING_CATEGORIES.some((c) => c.key === value);
}

function SampleForm({
  initialTitle,
  initialText,
  saving,
  onSubmit,
  onCancel,
}: {
  initialTitle?: string;
  initialText?: string;
  saving: boolean;
  onSubmit: (title: string, text: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [text, setText] = useState(initialText ?? '');

  const canSubmit = title.trim() !== '' && text.trim() !== '' && !saving;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-700/50">
      <input
        type="text"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
        placeholder="Sample title"
        maxLength={200}
        value={title}
        onChange={(e) => { setTitle(e.target.value); }}
      />
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
        rows={4}
        maxLength={10000}
        placeholder="Sample text..."
        value={text}
        onChange={(e) => { setText(e.target.value); }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          disabled={!canSubmit}
          onClick={() => void onSubmit(title, text)}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SampleRow({
  sample,
  saving,
  onEdit,
  onDelete,
}: {
  sample: WritingSample;
  saving: boolean;
  onEdit: (sample: WritingSample) => void;
  onDelete: (sampleId: string) => Promise<void>;
}): React.JSX.Element {
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!window.confirm(`Delete sample "${sample.title}"?`)) return;
    await onDelete(sample.id);
  }, [sample.id, sample.title, onDelete]);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="min-w-0 flex-1">
        <h4 className="font-medium text-slate-900 dark:text-slate-100">{sample.title}</h4>
        <p className="mt-1 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">
          {sample.text}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          disabled={saving}
          onClick={() => { onEdit(sample); }}
          title="Edit sample"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          disabled={saving}
          onClick={() => void handleDelete()}
          title="Delete sample"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function CategorySamplesPanel({
  category,
}: {
  category: WritingCategory;
}): React.JSX.Element {
  const { samples, loading, error, saving, createSample, updateSample, deleteSample } =
    useWritingSamples(category);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSample, setEditingSample] = useState<WritingSample | null>(null);

  const handleCreate = useCallback(
    async (title: string, text: string): Promise<void> => {
      await createSample(title, text);
      setShowAddForm(false);
    },
    [createSample]
  );

  const handleUpdate = useCallback(
    async (title: string, text: string): Promise<void> => {
      if (editingSample === null) return;
      await updateSample(editingSample.id, title, text);
      setEditingSample(null);
    },
    [editingSample, updateSample]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />

      <div className="text-sm text-slate-500 dark:text-slate-400">
        {String(samples.length)}/{String(MAX_SAMPLES)} samples
      </div>

      {samples.map((sample) =>
        editingSample?.id === sample.id ? (
          <SampleForm
            key={sample.id}
            initialTitle={sample.title}
            initialText={sample.text}
            saving={saving}
            onSubmit={handleUpdate}
            onCancel={() => { setEditingSample(null); }}
          />
        ) : (
          <SampleRow
            key={sample.id}
            sample={sample}
            saving={saving}
            onEdit={setEditingSample}
            onDelete={deleteSample}
          />
        )
      )}

      {showAddForm ? (
        <SampleForm
          saving={saving}
          onSubmit={handleCreate}
          onCancel={() => { setShowAddForm(false); }}
        />
      ) : (
        <button
          type="button"
          className="w-full rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
          disabled={samples.length >= MAX_SAMPLES}
          onClick={() => { setShowAddForm(true); }}
        >
          {samples.length >= MAX_SAMPLES ? 'Maximum samples reached' : '+ Add Sample'}
        </button>
      )}
    </div>
  );
}

export function HellscriptSamplesPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: WritingCategory = isValidTab(tabParam) ? tabParam : 'threads';

  const setActiveTab = useCallback(
    (tab: WritingCategory) => {
      setSearchParams({ tab }, { replace: true });
    },
    [setSearchParams]
  );

  return (
    <Layout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Sacred Scriptures
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Writing samples that shape the voice for each category.
          </p>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
          {WRITING_CATEGORIES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
              }`}
              onClick={() => { setActiveTab(key); }}
            >
              {label}
            </button>
          ))}
        </div>

        <CategorySamplesPanel key={activeTab} category={activeTab} />
      </div>
    </Layout>
  );
}
