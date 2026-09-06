import { describe, expect, it, vi } from 'vitest';
import type { IntexAgentServiceClient, WhatsAppServiceClient } from '@intexuraos/internal-clients';
import type { MatrixCorpusSignedControlMutationV1 } from '@intexuraos/http-contracts';
import { createMatrixCorpusControlPlaneClient } from '../matrixCorpus/controlPlaneClient.js';

const authorization: MatrixCorpusSignedControlMutationV1 = {
  version: 1,
  kind: 'matrix_corpus_control_mutation',
  eventId: 'event_1',
  leaseFence: '7',
  payloadDigest: 'a'.repeat(64),
  attestation: 'aaa.bbb.ccc',
};

describe('Matrix corpus control-plane composition', () => {
  it('authorizes each exact Intex mutation immediately and forwards the body unchanged', async () => {
    const authorize = vi.fn().mockResolvedValue({
      ok: true,
      value: { code: 'AUTHORIZED', authorization },
    });
    const register = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'applied' } });
    const projection = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'applied' } });
    const finalize = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'applied' } });
    const whatsapp = {
      authorizeMatrixCorpusControl: authorize,
    } as unknown as WhatsAppServiceClient;
    const intex = {
      registerMatrixCorpusContext: register,
      mutateMatrixCorpusProjection: projection,
      finalizeMatrixCorpusContext: finalize,
    } as unknown as IntexAgentServiceClient;
    const client = createMatrixCorpusControlPlaneClient({ whatsapp, intex });
    const contextRequest = {
      runtimeAudience: 'hetzner-prod',
      userId: 'user_1',
      leaseFence: '7',
      catalogDigest: 'a'.repeat(64),
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      expectedTimeZone: 'Europe/Warsaw',
    } as const;
    const projectionRequest = {
      kind: 'cas',
      userId: 'user_1',
      leaseFence: '7',
      command: { expectedRevision: 1 },
    } as const;
    const finalizeRequest = {
      runtimeAudience: 'hetzner-prod',
      userId: 'user_1',
      leaseFence: '7',
      expectedRevision: 2,
      artifactStageDigest: 'b'.repeat(64),
      terminalCandidate: {},
    } as const;

    await client.registerContext({ runId: 'run_1', leaseFence: '7', request: contextRequest });
    await client.mutateProjection({ runId: 'run_1', leaseFence: '7', request: projectionRequest });
    await client.finalizeContext({ runId: 'run_1', leaseFence: '7', request: finalizeRequest });

    expect(authorize.mock.calls.map((call) => call[0])).toEqual([
      { runId: 'run_1', leaseFence: '7', operation: 'register_context', request: contextRequest },
      {
        runId: 'run_1',
        leaseFence: '7',
        operation: 'advance_projection',
        request: projectionRequest,
      },
      { runId: 'run_1', leaseFence: '7', operation: 'finalize_run', request: finalizeRequest },
    ]);
    expect(register).toHaveBeenCalledWith({
      runId: 'run_1',
      authorization,
      request: contextRequest,
    });
    expect(projection).toHaveBeenCalledWith({
      runId: 'run_1',
      authorization,
      request: projectionRequest,
    });
    expect(finalize).toHaveBeenCalledWith({
      runId: 'run_1',
      authorization,
      request: finalizeRequest,
    });
  });

  it('does not call Intex when authorization fails', async () => {
    const whatsapp = {
      authorizeMatrixCorpusControl: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: 'rejected', httpStatus: 409 } }),
    } as unknown as WhatsAppServiceClient;
    const register = vi.fn();
    const intex = { registerMatrixCorpusContext: register } as unknown as IntexAgentServiceClient;
    const client = createMatrixCorpusControlPlaneClient({ whatsapp, intex });
    const result = await client.registerContext({
      runId: 'run_1',
      leaseFence: '7',
      request: {
        runtimeAudience: 'hetzner-prod',
        userId: 'user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        agentModel: 'or:deepseek/deepseek-v4-flash',
        evaluatorModel: 'or:minimax/minimax-m3',
        expectedTimeZone: 'Europe/Warsaw',
      },
    });

    expect(result).toEqual({ ok: false, error: { code: 'rejected', httpStatus: 409 } });
    expect(register).not.toHaveBeenCalled();
  });

  it('uses one immutable body snapshot across asynchronous authorization', async () => {
    let releaseAuthorization: (() => void) | undefined;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const authorize = vi.fn(async (_input: unknown) => {
      await authorizationGate;
      return { ok: true, value: { code: 'AUTHORIZED', authorization } } as const;
    });
    const projection = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'applied' } });
    const client = createMatrixCorpusControlPlaneClient({
      whatsapp: { authorizeMatrixCorpusControl: authorize } as unknown as WhatsAppServiceClient,
      intex: {
        mutateMatrixCorpusProjection: projection,
      } as unknown as IntexAgentServiceClient,
    });
    const request = {
      kind: 'cas' as const,
      userId: 'user_1',
      leaseFence: '7',
      command: { expectedRevision: 1 },
    };

    const pending = client.mutateProjection({ runId: 'run_1', leaseFence: '7', request });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    request.command.expectedRevision = 99;
    releaseAuthorization?.();
    await pending;

    expect(authorize.mock.calls[0]?.[0]).toMatchObject({
      request: { command: { expectedRevision: 1 } },
    });
    expect(projection.mock.calls[0]?.[0]).toMatchObject({
      request: { command: { expectedRevision: 1 } },
    });
  });
});
