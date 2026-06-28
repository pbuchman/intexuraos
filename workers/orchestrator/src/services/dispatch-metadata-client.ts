import { z } from 'zod';
import { WorkerTypeSchema } from '../types/schemas.js';

const DispatchMetadataSchema = z.object({
  taskId: z.string().min(1),
  prompt: z.string(),
  repository: z.string().min(1),
  baseBranch: z.string().min(1),
  agentType: z
    .enum(['planning', 'execution', 'pull_request', 'review', 'remediation', 'ask_agent', 'sentry'])
    .nullable(),
  workerType: WorkerTypeSchema,
  linearIssueId: z.string().min(1).nullable(),
  webhookSecret: z.string().min(1).nullable(),
  prNumber: z.number().int().positive().nullable(),
  webhookUrl: z.string().url(),
  continuationPrBranch: z.string().min(1).nullable(),
  trackingCommentId: z.string().min(1).nullable(),
});

export type DispatchMetadata = z.infer<typeof DispatchMetadataSchema>;

export interface DispatchMetadataClientConfig {
  codeAgentUrl: string;
  internalAuthToken: string;
  fetchFn?: typeof fetch;
}

export async function fetchDispatchMetadata(
  config: DispatchMetadataClientConfig,
  taskId: string
): Promise<DispatchMetadata | null> {
  const fetchFn = config.fetchFn ?? fetch;
  const url = `${config.codeAgentUrl.replace(/\/+$/, '')}/internal/tasks/${encodeURIComponent(taskId)}/dispatch-metadata`;

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'X-Internal-Auth': config.internalAuthToken,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    const parsed = DispatchMetadataSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
