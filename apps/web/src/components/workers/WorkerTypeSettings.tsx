import { useState } from 'react';
import {
  CODE_TASK_WORKER_CAPABILITIES as capabilities,
  CODE_TASK_WORKER_TYPES,
  isCodeTaskWorkerTypePolicy,
  type CodeTaskWorkerType,
  type CodeTaskWorkerTypePolicy,
} from '@intexuraos/code-task-domain/worker-types';
import { Button } from '@/components';
import type { MaskedWorkerConfig, WorkerConfigUpdateInput } from '@/services/workerSettingsApi.types';
import type { WorkerStatus } from '@/types';

const allTypes: CodeTaskWorkerTypePolicy = { enabledWorkerTypes: [...CODE_TASK_WORKER_TYPES], workerTypesRevision: 0 };
const claudeTypes = CODE_TASK_WORKER_TYPES.filter((type) => capabilities[type].cliRuntime === 'claude');
const codexTypes = CODE_TASK_WORKER_TYPES.filter((type) => capabilities[type].cliRuntime === 'codex');
const authLabels = {
  active: 'Active', disabled: 'Disabled', expired: 'Expired', not_configured: 'Not configured',
  invalid: 'Invalid', refresh_failed: 'Refresh failed',
};

interface Props {
  worker: MaskedWorkerConfig;
  status?: WorkerStatus | undefined;
  onUpdate: (config: WorkerConfigUpdateInput) => Promise<void>;
  onRefreshStatus?: (() => Promise<void>) | undefined;
}

export function WorkerTypeSettings({ worker, status, onUpdate, onRefreshStatus }: Props): React.JSX.Element {
  const stored = isCodeTaskWorkerTypePolicy(worker) ? worker : allTypes;
  const health = status?.details;
  const applied = isCodeTaskWorkerTypePolicy(health) && health.workerTypesRevision >= stored.workerTypesRevision ? health : stored;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CodeTaskWorkerTypePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = draft ?? applied;
  const selected = selection.enabledWorkerTypes;
  const conflict = draft !== null && draft.workerTypesRevision !== applied.workerTypesRevision;
  const allClaude = claudeTypes.every((type) => selected.includes(type));
  const someClaude = claudeTypes.some((type) => selected.includes(type));
  const needsClaude = applied.enabledWorkerTypes.some((type) => capabilities[type].auth.kind === 'claude');
  const claudeStatus = needsClaude ? health?.workerAuths?.claude?.status : 'disabled';

  function select(types: readonly CodeTaskWorkerType[], checked: boolean): void {
    setError(null);
    setDraft({
      workerTypesRevision: selection.workerTypesRevision,
      enabledWorkerTypes: CODE_TASK_WORKER_TYPES.filter((type) => types.includes(type) ? checked : selected.includes(type)),
    });
  }

  async function save(): Promise<void> {
    if (draft === null || conflict) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate({
        enabledWorkerTypes: draft.enabledWorkerTypes,
        expectedRevision: draft.workerTypesRevision,
        expectedRegistration: worker.registrationKey ?? worker.url,
      });
      setEditing(false);
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm worker types with this host.');
    } finally {
      setSaving(false);
      void onRefreshStatus?.();
    }
  }

  function option(type: CodeTaskWorkerType): React.JSX.Element {
    return (
      <label key={type} className="flex items-center gap-2">
        <input type="checkbox" checked={selected.includes(type)} onChange={(e) => { select([type], e.target.checked); }} />
        {capabilities[type].displayName}
      </label>
    );
  }

  return (
    <section className="mt-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-700" aria-label={`Worker types for ${worker.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium">Worker types</h4>
          <p className="text-slate-600 dark:text-slate-300">
            {applied.enabledWorkerTypes.length === CODE_TASK_WORKER_TYPES.length ? 'All types' :
              applied.enabledWorkerTypes.map((type) => capabilities[type].displayName).join(', ') || 'No types enabled'}
          </p>
          {claudeStatus !== undefined && <p className="text-xs text-slate-600 dark:text-slate-300">Claude OAuth · {authLabels[claudeStatus]}</p>}
        </div>
        {!editing && <Button variant="secondary" size="sm" onClick={() => {
          setEditing(true); setSaved(false); setError(null); void onRefreshStatus?.();
        }}>Edit worker types</Button>}
      </div>
      {saved && <p role="status" className="mt-2 text-green-700 dark:text-green-300">Worker types applied</p>}
      {editing && (
        <fieldset disabled={saving} className="mt-3 space-y-3">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={allClaude}
              ref={(el) => { if (el !== null) el.indeterminate = someClaude && !allClaude; }}
              onChange={(e) => { select(claudeTypes, e.target.checked); }} />
            Claude Code
          </label>
          <div className="grid gap-2 pl-5 sm:grid-cols-2">{claudeTypes.map(option)}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">OpenRouter Free uses an OpenRouter key. The other Claude Code types use Claude OAuth.</p>
          <fieldset>
            <legend className="mb-2 font-medium">Codex presets</legend>
            <div className="grid gap-2 pl-5 sm:grid-cols-2">{codexTypes.map(option)}</div>
          </fieldset>
          {error !== null && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
          {conflict && <div role="alert">
            <p>The settings changed on this host while you were editing.</p>
            <Button size="sm" variant="secondary" onClick={() => {
              setDraft({ enabledWorkerTypes: selected, workerTypesRevision: applied.workerTypesRevision });
            }}>Keep my selection</Button>
          </div>}
          <div className="flex gap-2">
            <Button size="sm" type="button" disabled={saving || draft === null || conflict} onClick={() => { void save(); }}>Save worker types</Button>
            <Button size="sm" type="button" variant="secondary" onClick={() => { setDraft(null); setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
