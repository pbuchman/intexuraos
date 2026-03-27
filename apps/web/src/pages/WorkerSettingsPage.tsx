import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Layout } from '@/components';
import { useWorkerSettings, useTimezone } from '@/hooks';
import type {
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';
import { WorkerRow } from '@/components/workers/WorkerRow.js';
import { AddWorkerForm } from '@/components/workers/AddWorkerForm.js';
import { DefaultReviewWorkerTypeCard } from '@/components/workers/DefaultReviewWorkerTypeCard.js';
import { DefaultWorkerTypeCard } from '@/components/workers/DefaultWorkerTypeCard.js';
import { TimezoneCard } from '@/components/workers/TimezoneCard.js';

const MAX_WORKERS = 2;

export function WorkerSettingsPage(): React.JSX.Element {
  const {
    settings,
    loading,
    error,
    addWorker,
    updateWorker,
    deleteWorker,
    testConnectivity,
    reorderWorkers,
    updateDefaultReviewWorkerType,
    updateDefaultRemediationWorkerType,
    updateDefaultExecutionWorkerType,
    updateDefaultPlanningWorkerType,
    updateDefaultPullRequestWorkerType,
  } = useWorkerSettings();

  const {
    timezone,
    saving: timezoneSaving,
    error: timezoneError,
    updateTimezone,
  } = useTimezone();

  const [showAddForm, setShowAddForm] = useState(false);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const workers = settings?.workers ?? [];
  const hasReachedMax = workers.length >= MAX_WORKERS;

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Worker Configuration</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {workers.length} workers configured · Configure your code execution workers. Each worker requires Cloudflare Access credentials and an orchestrator secret. Max {MAX_WORKERS} workers.
          </p>
        </div>
        {!showAddForm && !hasReachedMax && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={(): void => {
              setShowAddForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Worker
          </Button>
        )}
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div className="mb-6">
        <DefaultReviewWorkerTypeCard
          currentType={settings?.defaultReviewWorkerType ?? 'glm'}
          onUpdate={updateDefaultReviewWorkerType}
        />
      </div>
      <div className="mb-6">
        <DefaultWorkerTypeCard
          title="Default Remediation Model"
          description="Model used for automated code fixes after reviews find issues."
          successMessage="Default remediation model saved"
          currentType={settings?.defaultRemediationWorkerType ?? 'auto'}
          onUpdate={updateDefaultRemediationWorkerType}
        />
      </div>
      <div className="mb-6">
        <DefaultWorkerTypeCard
          title="Default Execution Model"
          description="Model used for implementing approved plans and code tasks."
          successMessage="Default execution model saved"
          currentType={settings?.defaultExecutionWorkerType ?? 'auto'}
          onUpdate={updateDefaultExecutionWorkerType}
        />
      </div>
      <div className="mb-6">
        <DefaultWorkerTypeCard
          title="Default Planning Model"
          description="Model used for creating implementation plans from task descriptions."
          successMessage="Default planning model saved"
          currentType={settings?.defaultPlanningWorkerType ?? 'auto'}
          onUpdate={updateDefaultPlanningWorkerType}
        />
      </div>
      <div className="mb-6">
        <DefaultWorkerTypeCard
          title="Default Pull Request Model"
          description="Model used for tasks triggered by PR comments."
          successMessage="Default pull request model saved"
          currentType={settings?.defaultPullRequestWorkerType ?? 'auto'}
          onUpdate={updateDefaultPullRequestWorkerType}
        />
      </div>

      <div className="mb-6">
        <TimezoneCard
          currentTimezone={timezone}
          saving={timezoneSaving}
          error={timezoneError}
          onUpdate={updateTimezone}
        />
      </div>

      <div className="space-y-4">
        {workers.map((worker, index) => (
          <WorkerRow
            key={worker.name}
            worker={worker}
            priority={index + 1}
            onUpdate={async (config: WorkerConfigUpdateInput): Promise<void> => {
              await updateWorker(worker.name, config);
            }}
            onDelete={async (): Promise<void> => {
              await deleteWorker(worker.name);
            }}
            onTest={async (): Promise<TestWorkerConnectivityResponse> => {
              return await testConnectivity(worker.name);
            }}
            onMoveUp={index > 0 ? async (): Promise<void> => {
              const reordered = [...workers];
              const prev = reordered[index - 1];
              const curr = reordered[index];
              if (prev !== undefined && curr !== undefined) {
                reordered[index - 1] = curr;
                reordered[index] = prev;
                await reorderWorkers(reordered.map((w) => w.name));
              }
            } : undefined}
            onMoveDown={index < workers.length - 1 ? async (): Promise<void> => {
              const reordered = [...workers];
              const curr = reordered[index];
              const next = reordered[index + 1];
              if (curr !== undefined && next !== undefined) {
                reordered[index] = next;
                reordered[index + 1] = curr;
                await reorderWorkers(reordered.map((w) => w.name));
              }
            } : undefined}
          />
        ))}

        {showAddForm && (
          <AddWorkerForm
            onCancel={(): void => {
              setShowAddForm(false);
            }}
            onAdd={async (config: WorkerConfigInput): Promise<void> => {
              await addWorker(config);
              setShowAddForm(false);
            }}
          />
        )}
      </div>
    </Layout>
  );
}
