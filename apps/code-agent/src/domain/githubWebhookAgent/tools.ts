import { z } from 'zod';
import type { Result } from '@intexuraos/common-core';
import { WorkerTypeSchema } from './models.js';
import type { ActionStep } from './models.js';
import type { ActionTool, ActionToolResult } from './executor.js';
import type { SendTaskMessageResult, SendTaskMessageError } from '../usecases/sendTaskMessage.js';
import type { CreateTaskForPRRequest, CreateTaskForPRError } from '../usecases/createTaskForPR.js';

const SendTaskMessageParamsSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  message: z.string().min(1),
});

const DispatchTaskParamsSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.number().int().positive(),
  prTitle: z.string().optional(),
  senderLogin: z.string().min(1),
  comment: z.string().min(1),
  eventId: z.string().min(1),
  workerType: z.string().optional(),
});

const MarkProcessingParamsSchema = z.object({
  repository: z.string().min(1),
  commentId: z.number().int().positive(),
});

const ChatNotifyParamsSchema = z.object({
  userId: z.string().min(1),
  eventId: z.string().min(1),
  threadKey: z.string().min(1),
  kind: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export interface ChatNotifyPort {
  emitSystemEvent(request: {
    userId: string;
    source: string;
    eventId: string;
    threadKey: string;
    kind: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<Result<{ delivered: boolean; duplicate: boolean }, { code: string; message: string }>>;
}

export interface ToolDeps {
  sendTaskMessage: (request: {
    taskId: string;
    userId: string;
    message: string;
  }) => Promise<Result<SendTaskMessageResult, SendTaskMessageError>>;
  createTaskForPR: (request: CreateTaskForPRRequest) => Promise<Result<{ taskId: string }, CreateTaskForPRError>>;
  chatAgentClient: ChatNotifyPort;
}

export function createSendTaskMessageTool(deps: ToolDeps): ActionTool {
  return {
    execute: async (step: ActionStep): Promise<ActionToolResult> => {
      const parsed = SendTaskMessageParamsSchema.safeParse(step.params);
      if (!parsed.success) {
        return { ok: false, error: `Invalid params: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')} required` };
      }

      const result = await deps.sendTaskMessage(parsed.data);

      if (!result.ok) {
        return { ok: false, error: `${result.error.code}: ${result.error.message}` };
      }

      return { ok: true };
    },
    idempotencyKey: (step: ActionStep): string => step.actionId,
  };
}

export function createDispatchTaskTool(deps: ToolDeps): ActionTool {
  return {
    execute: async (step: ActionStep): Promise<ActionToolResult> => {
      const parsed = DispatchTaskParamsSchema.safeParse(step.params);
      if (!parsed.success) {
        return { ok: false, error: `Invalid params: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')} required` };
      }

      const request: CreateTaskForPRRequest = {
        repository: parsed.data.repository,
        prNumber: parsed.data.prNumber,
        senderLogin: parsed.data.senderLogin,
        comment: parsed.data.comment,
        eventId: parsed.data.eventId,
      };
      if (parsed.data.prTitle !== undefined) {
        request.prTitle = parsed.data.prTitle;
      }
      const rawWorkerType = parsed.data.workerType;
      if (rawWorkerType !== undefined) {
        const wtParsed = WorkerTypeSchema.safeParse(rawWorkerType);
        if (wtParsed.success) {
          request.workerType = wtParsed.data;
        }
      }

      const result = await deps.createTaskForPR(request);

      if (!result.ok) {
        return { ok: false, error: `${result.error.code}: ${result.error.message}` };
      }

      return { ok: true };
    },
    idempotencyKey: (step: ActionStep): string => step.actionId,
  };
}

export interface MarkProcessingToolDeps {
  addReaction: (repository: string, commentId: number) => Promise<Result<void, { code: string; message: string }>>;
}

export function createMarkProcessingTool(deps: MarkProcessingToolDeps): ActionTool {
  return {
    execute: async (step: ActionStep): Promise<ActionToolResult> => {
      const parsed = MarkProcessingParamsSchema.safeParse(step.params);
      if (!parsed.success) {
        return { ok: false, error: `Invalid params: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')} required` };
      }

      const result = await deps.addReaction(parsed.data.repository, parsed.data.commentId);

      if (!result.ok) {
        return { ok: false, error: `${result.error.code}: ${result.error.message}` };
      }

      return { ok: true };
    },
    idempotencyKey: (step: ActionStep): string => step.actionId,
  };
}

export function createChatNotifyTool(deps: ToolDeps): ActionTool {
  return {
    execute: async (step: ActionStep): Promise<ActionToolResult> => {
      const parsed = ChatNotifyParamsSchema.safeParse(step.params);
      if (!parsed.success) {
        return { ok: false, error: `Invalid params: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')} required` };
      }

      const result = await deps.chatAgentClient.emitSystemEvent({
        userId: parsed.data.userId,
        source: 'github-webhook-agent',
        eventId: parsed.data.eventId,
        threadKey: parsed.data.threadKey,
        kind: parsed.data.kind,
        message: parsed.data.message,
        ...(parsed.data.metadata !== undefined && { metadata: parsed.data.metadata }),
      });

      if (!result.ok) {
        return { ok: false, error: `${result.error.code}: ${result.error.message}` };
      }

      return { ok: true };
    },
    idempotencyKey: (step: ActionStep): string => step.actionId,
  };
}
