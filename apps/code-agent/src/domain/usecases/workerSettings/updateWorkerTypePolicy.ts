import { err, type Result } from '@intexuraos/common-core';
import {
  isCodeTaskWorkerTypePolicy,
  type CodeTaskWorkerTypePolicy,
} from '@intexuraos/code-task-domain';
import type { WorkerConfig, WorkerTypePolicyUpdate } from '../../models/workerSettings.js';
import { workerRegistrationKey } from '../../models/workerSettings.js';
import type { WorkerHealthProbe } from '../../ports/workerHealthProbe.js';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';

export type PutWorkerTypePolicy = (
  worker: WorkerConfig,
  update: WorkerTypePolicyUpdate
) => Promise<Result<CodeTaskWorkerTypePolicy, 'conflict' | 'unsupported' | 'unauthorized' | 'unconfirmed'>>;

interface UpdateWorkerTypePolicyDeps {
  workerSettingsRepo: WorkerSettingsRepository;
  workerHealthProbe: WorkerHealthProbe;
  putWorkerTypePolicy: PutWorkerTypePolicy;
}

interface UpdateError {
  code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
}

function sameSelection(policy: CodeTaskWorkerTypePolicy, update: Pick<WorkerTypePolicyUpdate, 'enabledWorkerTypes'>): boolean {
  return policy.enabledWorkerTypes.length === update.enabledWorkerTypes.length
    && policy.enabledWorkerTypes.every((type) => update.enabledWorkerTypes.includes(type));
}

const conflict: UpdateError = {
  code: 'CONFLICT',
  message: 'Worker types changed on the host. Refresh the worker status and try again.',
};

const unsupported: UpdateError = {
  code: 'INVALID_REQUEST',
  message: 'This worker does not support editing enabled task types. Update the orchestrator to enable editing.',
};

const unavailable: UpdateError = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'Worker types could not be confirmed. Check the worker connection and try again.',
};

export async function updateWorkerTypePolicy(
  { workerSettingsRepo, workerHealthProbe, putWorkerTypePolicy }: UpdateWorkerTypePolicyDeps,
  userId: string,
  workerName: string,
  expectedRegistration: string,
  update: WorkerTypePolicyUpdate
): Promise<Result<CodeTaskWorkerTypePolicy, UpdateError>> {
  const found = await workerSettingsRepo.getWorkerByName(userId, workerName);
  if (!found.ok) return err({ code: 'INTERNAL_ERROR', message: 'Failed to load worker settings' });
  if (found.value === null) return err({ code: 'NOT_FOUND', message: 'Worker not found' });
  const worker = found.value;
  if (workerRegistrationKey(worker) !== expectedRegistration) {
    return err({ code: 'CONFLICT', message: 'This worker registration changed. Refresh the settings before editing this host.' });
  }

  async function confirm(policy: CodeTaskWorkerTypePolicy): Promise<Result<CodeTaskWorkerTypePolicy, UpdateError>> {
    const result = await workerSettingsRepo.confirmWorkerTypePolicy(userId, worker, {
      enabledWorkerTypes: policy.enabledWorkerTypes,
      workerTypesRevision: policy.workerTypesRevision,
    });
    if (result.ok) return result;
    return err(result.error.code === 'registration_changed'
      ? { code: 'CONFLICT', message: result.error.message }
      : { code: 'INTERNAL_ERROR', message: result.error.message });
  }

  const health = await workerHealthProbe.probeWorker(worker);
  if (health._tag !== 'healthy') return err(unavailable);
  if (!isCodeTaskWorkerTypePolicy(health)) return err(unsupported);
  const before = await confirm(health);
  if (!before.ok) return before;
  if (before.value.workerTypesRevision !== health.workerTypesRevision ||
      !sameSelection(before.value, health) ||
      update.expectedRevision > health.workerTypesRevision) {
    return err(conflict);
  }
  if (sameSelection(before.value, update)) return before;
  if (update.expectedRevision !== health.workerTypesRevision) return err(conflict);

  const write = await putWorkerTypePolicy(worker, update);
  if (!write.ok && write.error === 'unsupported') return err(unsupported);
  if (!write.ok && write.error === 'unauthorized') {
    return err({ code: 'SERVICE_UNAVAILABLE', message: 'Worker denied the request. Check the registered credentials.' });
  }

  if (write.ok && write.value.workerTypesRevision > update.expectedRevision && sameSelection(write.value, update)) {
    const confirmed = await confirm(write.value);
    if (!confirmed.ok || sameSelection(confirmed.value, update)) return confirmed;
    return err(conflict);
  }

  const readback = await workerHealthProbe.probeWorker(worker);
  if (readback._tag === 'healthy' && isCodeTaskWorkerTypePolicy(readback)) {
    const confirmed = await confirm(readback);
    if (!confirmed.ok) return confirmed;
    if (readback.workerTypesRevision > update.expectedRevision && sameSelection(readback, update)
        && sameSelection(confirmed.value, update)) {
      return confirmed;
    }
    if (confirmed.value.workerTypesRevision > update.expectedRevision) return err(conflict);
  }
  return err(!write.ok && write.error === 'conflict' ? conflict : unavailable);
}
