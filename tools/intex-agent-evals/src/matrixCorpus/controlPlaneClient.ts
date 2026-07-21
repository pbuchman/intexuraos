import type {
  IntexAgentServiceClient,
  MatrixCorpusAuthorizedRequest,
  MatrixCorpusClientResult,
  MatrixCorpusFinalizeRequest,
  MatrixCorpusProjectionRequest,
  MatrixCorpusRegisterContextRequest,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import type { MatrixCorpusSignedControlMutationV1 } from '@intexuraos/http-contracts';

type WhatsAppControlClient = Pick<
  WhatsAppServiceClient,
  | 'provisionMatrixCorpusRun'
  | 'activateMatrixCorpusRun'
  | 'renewMatrixCorpusLease'
  | 'issueMatrixCorpusCapability'
  | 'authorizeMatrixCorpusControl'
  | 'getMatrixCorpusTransportStatus'
  | 'quiesceMatrixCorpusRun'
  | 'releaseMatrixCorpusRun'
  | 'cleanupMatrixCorpusRun'
>;

export interface MatrixCorpusControlPlaneClient {
  readonly whatsapp: WhatsAppControlClient;
  readonly intex: IntexAgentServiceClient;
  registerContext(input: {
    runId: string;
    leaseFence: string;
    request: MatrixCorpusRegisterContextRequest;
  }): ReturnType<IntexAgentServiceClient['registerMatrixCorpusContext']>;
  mutateProjection(input: {
    runId: string;
    leaseFence: string;
    request: MatrixCorpusProjectionRequest;
  }): ReturnType<IntexAgentServiceClient['mutateMatrixCorpusProjection']>;
  finalizeContext(input: {
    runId: string;
    leaseFence: string;
    request: MatrixCorpusFinalizeRequest;
  }): ReturnType<IntexAgentServiceClient['finalizeMatrixCorpusContext']>;
}

export function createMatrixCorpusControlPlaneClient(input: {
  whatsapp: WhatsAppControlClient;
  intex: IntexAgentServiceClient;
}): MatrixCorpusControlPlaneClient {
  return {
    whatsapp: input.whatsapp,
    intex: input.intex,

    async registerContext(
      command
    ): ReturnType<IntexAgentServiceClient['registerMatrixCorpusContext']> {
      return await authorizeAndMutate(
        input,
        command.runId,
        command.leaseFence,
        'register_context',
        command.request,
        async (authorization, request) =>
          await input.intex.registerMatrixCorpusContext({
            runId: command.runId,
            authorization,
            request,
          })
      );
    },

    async mutateProjection(
      command
    ): ReturnType<IntexAgentServiceClient['mutateMatrixCorpusProjection']> {
      return await authorizeAndMutate(
        input,
        command.runId,
        command.leaseFence,
        command.request.kind === 'create' ? 'create_projection' : 'advance_projection',
        command.request,
        async (authorization, request) =>
          await input.intex.mutateMatrixCorpusProjection({
            runId: command.runId,
            authorization,
            request,
          })
      );
    },

    async finalizeContext(
      command
    ): ReturnType<IntexAgentServiceClient['finalizeMatrixCorpusContext']> {
      return await authorizeAndMutate(
        input,
        command.runId,
        command.leaseFence,
        'finalize_run',
        command.request,
        async (authorization, request) =>
          await input.intex.finalizeMatrixCorpusContext({
            runId: command.runId,
            authorization,
            request,
          })
      );
    },
  };
}

async function authorizeAndMutate<TRequest extends object, TResult>(
  clients: { whatsapp: WhatsAppControlClient },
  runId: string,
  leaseFence: string,
  operation: 'register_context' | 'finalize_run' | 'create_projection' | 'advance_projection',
  request: TRequest,
  mutate: (
    authorization: MatrixCorpusSignedControlMutationV1,
    request: TRequest
  ) => Promise<MatrixCorpusClientResult<TResult>>
): Promise<MatrixCorpusClientResult<TResult>> {
  const requestSnapshot = immutableJsonSnapshot(request);
  if (requestSnapshot === null) {
    return { ok: false, error: { code: 'invalid_request' } };
  }
  const authorization = await clients.whatsapp.authorizeMatrixCorpusControl({
    runId,
    leaseFence,
    operation,
    request: requestSnapshot as Readonly<Record<string, unknown>>,
  });
  if (!authorization.ok) return authorization;
  return await mutate(authorization.value.authorization, requestSnapshot);
}

function immutableJsonSnapshot<T extends object>(request: T): T | null {
  try {
    const encoded = JSON.stringify(request);
    const decoded: unknown = JSON.parse(encoded);
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    return deepFreeze(decoded) as T;
  } catch {
    return null;
  }
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export type { MatrixCorpusAuthorizedRequest };
