import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain';

export class WorkerTypeDisabledError extends Error {
  readonly type = 'worker_type_disabled' as const;

  constructor(workerType: CodeTaskWorkerType) {
    super(
      `Worker type '${workerType}' is disabled on this host. Enable it in Worker types or select another worker.`
    );
  }
}
