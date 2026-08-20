import { createHash } from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import type FirebaseFirestore from '@google-cloud/firestore';
import type { CodeTask } from '../../models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
  RepositoryError,
} from '../../repositories/codeTaskRepository.js';

export function buildGitHubEventTaskId(action: string, eventId: string): string {
  const digest = createHash('sha256')
    .update(`${action}\0${eventId}`)
    .digest('hex')
    .slice(0, 40);
  return `task_github_${digest}`;
}

export async function reserveGitHubEventTask(input: {
  codeTaskRepo: CodeTaskRepository;
  transaction: FirebaseFirestore.Transaction;
  taskInput: CreateTaskInput & { id: string };
}): Promise<Result<{ task: CodeTask; created: boolean }, RepositoryError>> {
  const { codeTaskRepo, transaction, taskInput } = input;
  const existingResult = await codeTaskRepo.findById(taskInput.id, { transaction });

  if (existingResult.ok) {
    const existing = existingResult.value;
    if (
      existing.traceId !== taskInput.traceId
      || existing.userId !== taskInput.userId
      || existing.systemPromptHash !== taskInput.systemPromptHash
    ) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: `Deterministic GitHub event task id collision for ${taskInput.id}`,
      });
    }
    return ok({ task: existing, created: false });
  }

  if (existingResult.error.code !== 'NOT_FOUND') {
    return err(existingResult.error);
  }

  const createResult = await codeTaskRepo.create(taskInput, { transaction });
  if (!createResult.ok) {
    return err(createResult.error);
  }
  return ok({ task: createResult.value, created: true });
}
