/**
 * Cron Agent Domain Types.
 *
 * Types for cron schedules and execution records.
 * @packageDocumentation
 */

export type ScheduleStatus = 'active' | 'paused' | 'deleted';
export type ExecutionStatus = 'running' | 'success' | 'failure' | 'skipped';
export type TriggerType = 'scheduled' | 'manual';

export interface ScheduleAction {
  services: string[];
  instruction: string;
  preferredTools: string[];
}

export interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  action: ScheduleAction;
  status: ScheduleStatus;
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  executionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallLog {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export interface CronExecution {
  id: string;
  scheduleId: string;
  scheduleName: string;
  userId: string;
  status: ExecutionStatus;
  trigger: TriggerType;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  toolCalls: ToolCallLog[];
  agentResponse: string | null;
  tokenUsage: TokenUsage | null;
  error: string | null;
  createdAt: string;
}

export interface CreateScheduleInput {
  name: string;
  description: string;
  action: ScheduleAction;
  timezone: string;
}

export interface UpdateScheduleInput {
  name?: string | undefined;
  description?: string | undefined;
  status?: ScheduleStatus | undefined;
  action?: ScheduleAction | undefined;
  timezone?: string | undefined;
}

export interface CreateExecutionInput {
  scheduleId: string;
  scheduleName: string;
  userId: string;
  trigger: TriggerType;
}

export interface ListOptions {
  status?: ScheduleStatus[] | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface ExecutionListOptions {
  scheduleId?: string | undefined;
  status?: ExecutionStatus[] | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface ListSchedulesResponse {
  schedules: CronSchedule[];
  nextCursor: string | null;
  count: number;
}

export interface ListExecutionsResponse {
  executions: CronExecution[];
  nextCursor: string | null;
  count: number;
}

export interface ActionResult {
  outcome: 'success' | 'failure';
  agentResponse: string;
  toolCalls: ToolCallLog[];
  tokenUsage: TokenUsage;
}

type ScheduleActionLike = Omit<ScheduleAction, 'preferredTools'> & {
  preferredTools?: string[] | undefined;
};

function uniqueOrderedStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function normalizeScheduleAction(action: ScheduleActionLike): ScheduleAction {
  return {
    services: uniqueOrderedStrings(action.services),
    instruction: action.instruction,
    preferredTools: uniqueOrderedStrings(action.preferredTools ?? []),
  };
}

export function normalizeCronSchedule(schedule: CronSchedule): CronSchedule {
  return {
    ...schedule,
    action: normalizeScheduleAction(schedule.action),
  };
}
