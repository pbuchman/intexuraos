import { useState } from 'react';
import { Card } from '@/components';
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core/code-task-worker-types';
import { WORKER_TYPE_METADATA } from './shared.js';

export interface DefaultWorkerTypeCardProps {
  title: string;
  description: string;
  successMessage: string;
  currentType: string;
  onUpdate: (workerType: string) => Promise<void>;
}

export function DefaultWorkerTypeCard({
  title,
  description,
  successMessage,
  currentType,
  onUpdate,
}: DefaultWorkerTypeCardProps): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSelect = async (type: string): Promise<void> => {
    if (type === currentType) return;
    setSaving(true);
    setPendingType(type);
    setSaveSuccess(false);
    try {
      await onUpdate(type);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } finally {
      setSaving(false);
      setPendingType(null);
    }
  };

  return (
    <Card>
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
      {saveSuccess ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">✓ {successMessage}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {CODE_TASK_WORKER_TYPES.map((type) => {
          const meta = WORKER_TYPE_METADATA[type];
          return (
            <button
              key={type}
              type="button"
              onClick={(): void => {
                void handleSelect(type);
              }}
              disabled={saving}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                currentType === type
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
              } disabled:opacity-50`}
              title={meta.description}
            >
              {pendingType === type ? (
                <span className="flex items-center justify-center w-full h-full">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </span>
              ) : (
                meta.name
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
