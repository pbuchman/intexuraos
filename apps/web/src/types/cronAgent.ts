/**
 * Cron Agent types matching the cron-agent backend API contract.
 */

export interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  action: {
    services: string[];
    instruction: string;
    preferredTools: string[];
  };
  status: 'active' | 'paused' | 'deleted';
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  executionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CronScheduleStatus = CronSchedule['status'];

export interface ToolCallLog {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface CronExecution {
  id: string;
  scheduleId: string;
  scheduleName: string;
  userId: string;
  status: 'running' | 'success' | 'failure' | 'skipped';
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  toolCalls: ToolCallLog[];
  agentResponse: string | null;
  tokenUsage: { inputTokens: number; outputTokens: number; totalCost: number } | null;
  error: string | null;
  createdAt: string;
}

export type CronExecutionStatus = CronExecution['status'];

export interface ServiceInfo {
  key: string;
  name: string;
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
}

export interface ListSchedulesResponse {
  schedules: CronSchedule[];
  nextCursor?: string;
  total: number;
}

export interface ListExecutionsResponse {
  executions: CronExecution[];
  nextCursor?: string;
  total: number;
}

export interface CreateScheduleRequest {
  name: string;
  description: string;
  action: CronSchedule['action'];
  timezone?: string;
}
