import { config } from '@/config';
import type {
  ConversationAssistantContextCheckRequest,
  ConversationAssistantContextCheckResponse,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  ConversationAssistantSessionsResponse,
  ConversationAssistantTurnsResponse,
  CreateConversationAssistantSessionRequest,
  SendConversationAssistantTurnRequest,
} from '@/types';
import { ApiError, apiRequest } from './apiClient.js';
import { newRequestId } from './requestId.js';

const CONVERSATION_ASSISTANT_SESSIONS_PATH = '/conversation-assistant/sessions';
const CONVERSATION_ASSISTANT_CONTEXT_CHECK_PATH = '/conversation-assistant/context/check';

interface ConversationAssistantSessionResponse {
  session: ConversationAssistantSession;
}

interface CreateConversationAssistantSessionResponse {
  session: ConversationAssistantSession;
  turns: ConversationAssistantTurn[];
}

function getSessionPath(sessionId: string): string {
  return `${CONVERSATION_ASSISTANT_SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

export async function listConversationAssistantSessions(
  accessToken: string
): Promise<ConversationAssistantSessionsResponse> {
  return await apiRequest<ConversationAssistantSessionsResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken
  );
}

export async function createConversationAssistantSession(
  accessToken: string,
  request: CreateConversationAssistantSessionRequest
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<CreateConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
  return response.session;
}

export async function checkConversationAssistantContext(
  accessToken: string,
  request: ConversationAssistantContextCheckRequest
): Promise<ConversationAssistantContextCheckResponse> {
  return await apiRequest<ConversationAssistantContextCheckResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_CONTEXT_CHECK_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function getConversationAssistantSession(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<ConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    getSessionPath(sessionId),
    accessToken
  );
  return response.session;
}

export async function listConversationAssistantTurns(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantTurnsResponse> {
  return await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken
  );
}

export async function streamConversationAssistantTurn(
  accessToken: string,
  sessionId: string,
  request: SendConversationAssistantTurnRequest,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): Promise<void> {
  const response = await fetch(
    `${config.whatsappServiceUrl}${getSessionPath(sessionId)}/turns/stream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Request-Id': newRequestId(),
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.body === null) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'Streaming response was empty', response.status);
  }

  await readConversationAssistantEventStream(response.body, onEvent);
}

async function readConversationAssistantEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let next = await reader.read();
  while (!next.done) {
    buffer += decoder.decode(next.value, { stream: true });
    buffer = dispatchCompleteSseFrames(buffer, onEvent);
    next = await reader.read();
  }

  buffer += decoder.decode();
  if (buffer.trim() !== '') {
    dispatchSseFrame(buffer, onEvent);
  }
}

function dispatchCompleteSseFrames(
  buffer: string,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): string {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    dispatchSseFrame(frame, onEvent);
  }
  return remainder;
}

function dispatchSseFrame(
  frame: string,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): void {
  const lines = frame.split('\n');
  const eventType = lines
    .find((line) => line.startsWith('event: '))
    ?.slice('event: '.length);
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  if (eventType === undefined || data === '') return;
  onEvent(JSON.parse(data) as ConversationAssistantStreamEvent);
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: unknown; message?: unknown; details?: Record<string, unknown> };
    };
    const code = typeof payload.error?.code === 'string' ? payload.error.code : 'UNKNOWN';
    const message =
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : `Unexpected response from server (${String(response.status)})`;
    return new ApiError(code, message, response.status, payload.error?.details);
  } catch {
    return new ApiError(
      'SERVICE_UNAVAILABLE',
      `Unexpected response from server (${String(response.status)})`,
      response.status
    );
  }
}

export async function sendConversationAssistantTurn(
  accessToken: string,
  sessionId: string,
  request: SendConversationAssistantTurnRequest
): Promise<ConversationAssistantTurnsResponse> {
  return await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}
