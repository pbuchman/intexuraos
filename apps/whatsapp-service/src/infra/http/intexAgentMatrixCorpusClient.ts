import {
  createInternalHttpClient,
  createIntexAgentServiceClient,
  type InternalHttpClientLogger,
} from '@intexuraos/internal-clients';
import {
  matrixCorpusDecimalFenceSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSignedTerminalControlV1Schema,
} from '@intexuraos/http-contracts';
import { z } from 'zod';

import {
  matrixCorpusControlStatusResultSchema,
  matrixCorpusCurrentAcceptanceResultSchema,
  matrixCorpusPostTerminalControlResultSchema,
  type IntexAgentMatrixCorpusClient,
} from '../../domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.js';

const currentAcceptanceInputSchema = z
  .object({
    runtimeAudience: z.literal('hetzner-prod'),
    userId: matrixCorpusSafeIdSchema,
  })
  .strict();
const controlStatusInputSchema = z
  .object({
    runtimeAudience: z.literal('hetzner-prod'),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
  })
  .strict();
const terminalControlInputSchema = z
  .object({
    runId: matrixCorpusSafeIdSchema,
    envelope: matrixCorpusSignedTerminalControlV1Schema,
  })
  .strict();
const turnTerminalInputSchema = controlStatusInputSchema
  .extend({
    scenarioId: matrixCorpusSafeIdSchema,
    turnIndex: z.number().int().min(0).max(19),
  })
  .strict();

export interface IntexAgentMatrixCorpusClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  timeoutMs?: number;
}

export function createIntexAgentMatrixCorpusClient(
  config: IntexAgentMatrixCorpusClientConfig
): IntexAgentMatrixCorpusClient {
  const privacyLogger = createPrivacyLogger(config.logger);
  const http = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: privacyLogger,
    ...(config.timeoutMs === undefined ? {} : { defaultTimeoutMs: config.timeoutMs }),
  });
  const evidence = createIntexAgentServiceClient({
    baseUrl: config.baseUrl,
    internalAuthToken: config.internalAuthToken,
    logger: privacyLogger,
    ...(config.timeoutMs === undefined ? {} : { defaultTimeoutMs: config.timeoutMs }),
  });

  return {
    async getCurrentAcceptance(
      input
    ): ReturnType<IntexAgentMatrixCorpusClient['getCurrentAcceptance']> {
      const parsedInput = currentAcceptanceInputSchema.safeParse(input);
      if (!parsedInput.success) return { kind: 'not_ready' };
      const response = await http.request<unknown>({
        method: 'POST',
        path: '/internal/matrix-corpus/current-acceptance',
        body: parsedInput.data,
        skipSentry: true,
      });
      if (!response.ok) return { kind: 'not_ready' };
      const parsed = matrixCorpusCurrentAcceptanceResultSchema.safeParse(response.value);
      return parsed.success ? parsed.data : { kind: 'not_ready' };
    },

    async getControlStatus(input): ReturnType<IntexAgentMatrixCorpusClient['getControlStatus']> {
      const parsedInput = controlStatusInputSchema.safeParse(input);
      if (!parsedInput.success) return { kind: 'not_ready' };
      const response = await http.request<unknown>({
        method: 'GET',
        path: `/internal/matrix-corpus/runs/${encodeURIComponent(parsedInput.data.runId)}/control-status`,
        extraHeaders: {
          'x-matrix-corpus-runtime-audience': parsedInput.data.runtimeAudience,
          'x-matrix-corpus-user-id': parsedInput.data.userId,
          'x-matrix-corpus-lease-fence': parsedInput.data.leaseFence,
        },
        skipSentry: true,
      });
      if (!response.ok) return { kind: 'not_ready' };
      const parsed = matrixCorpusControlStatusResultSchema.safeParse(response.value);
      if (!parsed.success) return { kind: 'not_ready' };
      if (
        parsed.data.kind === 'status' &&
        (parsed.data.runId !== parsedInput.data.runId ||
          parsed.data.userId !== parsedInput.data.userId ||
          parsed.data.leaseFence !== parsedInput.data.leaseFence)
      )
        return { kind: 'not_ready' };
      return parsed.data;
    },

    async getTurnTerminal(input): ReturnType<IntexAgentMatrixCorpusClient['getTurnTerminal']> {
      const parsedInput = turnTerminalInputSchema.safeParse(input);
      if (!parsedInput.success) return { kind: 'not_ready' };
      const identity = {
        runId: parsedInput.data.runId,
        userId: parsedInput.data.userId,
        leaseFence: parsedInput.data.leaseFence,
      };
      const status = await evidence.getMatrixCorpusScenarioStatus({
        ...identity,
        scenarioId: parsedInput.data.scenarioId,
      });
      if (
        !status.ok ||
        status.value.kind !== 'status' ||
        status.value.runId !== parsedInput.data.runId ||
        status.value.userId !== parsedInput.data.userId ||
        status.value.leaseFence !== parsedInput.data.leaseFence ||
        status.value.scenarioId !== parsedInput.data.scenarioId
      )
        return { kind: 'not_ready' };
      const exactEvidence = await evidence.getMatrixCorpusEvidence({
        ...identity,
        scenarioId: parsedInput.data.scenarioId,
        sessionId: status.value.sessionId,
        eventRevision: status.value.eventRevision,
      });
      if (!exactEvidence.ok) return { kind: 'not_ready' };
      const terminals = exactEvidence.value.turnTerminals.filter(
        (candidate) => candidate.turnIndex === parsedInput.data.turnIndex
      );
      const terminal = terminals[0];
      if (terminals.length !== 1 || terminal === undefined) return { kind: 'not_ready' };
      return {
        kind: 'terminal',
        ...identity,
        scenarioId: parsedInput.data.scenarioId,
        turnIndex: parsedInput.data.turnIndex,
        status: terminal.status,
        terminalMarkerDigest: terminal.terminalMarkerDigest,
        recordedAt: terminal.recordedAt,
      };
    },

    async postTerminalControl(
      input
    ): ReturnType<IntexAgentMatrixCorpusClient['postTerminalControl']> {
      const parsedInput = terminalControlInputSchema.safeParse(input);
      if (!parsedInput.success) return { kind: 'not_ready' };
      const response = await http.request<unknown>({
        method: 'POST',
        path: `/internal/matrix-corpus/runs/${encodeURIComponent(parsedInput.data.runId)}/terminal-control`,
        body: parsedInput.data.envelope,
        skipSentry: true,
      });
      if (!response.ok) return { kind: 'not_ready' };
      const parsed = matrixCorpusPostTerminalControlResultSchema.safeParse(response.value);
      if (!parsed.success) return { kind: 'not_ready' };
      if (
        parsed.data.kind === 'acknowledged' &&
        (parsed.data.runId !== parsedInput.data.runId ||
          parsed.data.leaseFence !== parsedInput.data.envelope.leaseFence ||
          parsed.data.requestEventId !== parsedInput.data.envelope.eventId ||
          parsed.data.requestPayloadDigest !== parsedInput.data.envelope.payloadDigest)
      )
        return { kind: 'not_ready' };
      return parsed.data;
    },
  };
}

function createPrivacyLogger(logger: InternalHttpClientLogger): InternalHttpClientLogger {
  const safeLog = (): void => {
    logger.warn(
      { component: 'intex-agent-matrix-corpus-client' },
      'Intex Agent Matrix corpus request failed'
    );
  };
  return {
    info: () => undefined,
    debug: () => undefined,
    error: safeLog,
    warn: safeLog,
  };
}
