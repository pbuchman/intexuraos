import { taskAudience } from '@intexuraos/code-task-domain/task-access';
import type { CodeTask } from '../models/codeTask.js';
import type { WorkerConfig } from '../models/workerSettings.js';
import type { TaskMessageWorkerCredentials } from './taskDispatcher.js';

export function resolveAssignedTaskMessageWorker(
  task: Pick<CodeTask, 'userId' | 'status' | 'workerType' | 'workerLocation' | 'workerAudience'>,
  workers: readonly WorkerConfig[],
): TaskMessageWorkerCredentials | undefined {
  const worker = workers.find((candidate) => candidate.enabled && candidate.name === task.workerLocation);
  if (worker === undefined) return undefined;

  let url: string;
  try {
    url = taskAudience(worker.url);
    if (task.workerAudience !== undefined && url !== taskAudience(task.workerAudience)) return undefined;
  } catch {
    return undefined;
  }

  return {
    url,
    cfAccessClientId: worker.cfAccessClientId,
    cfAccessClientSecret: worker.cfAccessClientSecret,
    dispatchSigningSecret: worker.dispatchSigningSecret,
    ...(task.status !== 'running' && {
      resume: { ownerId: task.userId, workerType: task.workerType, worker },
    }),
  };
}
