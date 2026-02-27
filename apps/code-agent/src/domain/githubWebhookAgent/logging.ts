export const AGENT_NAME = 'GitHubWebhookAgent';

export const BODY_PREVIEW_LIMIT = 500;

export const REDACTED_KEYS: readonly string[] = [
  'x-hub-signature-256',
  'x-hub-signature',
  'authorization',
  'token',
  'secret',
  'access_token',
  'refresh_token',
];

const REDACTED_VALUE = '[REDACTED]';

export interface StepContextInput {
  runId: string;
  savedEventId: string;
  step: string;
}

export interface StepContext {
  agent: string;
  runId: string;
  savedEventId: string;
  step: string;
}

export function createStepContext(input: StepContextInput): StepContext {
  return {
    agent: AGENT_NAME,
    runId: input.runId,
    savedEventId: input.savedEventId,
    step: input.step,
  };
}

export interface StepFinishInput {
  runId: string;
  savedEventId: string;
  step: string;
  startedAt: number;
  outcome: 'success' | 'error' | 'skipped';
  error?: string;
}

export interface StepFinishResult {
  agent: string;
  runId: string;
  savedEventId: string;
  step: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'skipped';
  error?: string;
}

export function logStepFinish(input: StepFinishInput): StepFinishResult {
  const durationMs = Math.max(0, Date.now() - input.startedAt);
  return {
    agent: AGENT_NAME,
    runId: input.runId,
    savedEventId: input.savedEventId,
    step: input.step,
    durationMs,
    outcome: input.outcome,
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}

export function toBodyPreview(body: string | null | undefined): string {
  if (body === null || body === undefined) {
    return '';
  }
  if (body.length <= BODY_PREVIEW_LIMIT) {
    return body;
  }
  return body.slice(0, BODY_PREVIEW_LIMIT) + '...';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.includes(key.toLowerCase())) {
      result[key] = REDACTED_VALUE;
    } else if (isRecord(value)) {
      result[key] = redactObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactWebhookPayload<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (!isRecord(payload)) {
    return payload;
  }
  return redactObject(payload) as T;
}
