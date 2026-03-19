import type { Result } from '@intexuraos/common-core';
import type { CronExecution, CreateExecutionInput, ExecutionListOptions, ListExecutionsResponse } from '../types.js';

export interface ExecutionRepositoryError {
  code: 'NOT_FOUND' | 'INTERNAL_ERROR';
  message: string;
}

export interface ExecutionRepository {
  create(input: CreateExecutionInput): Promise<Result<CronExecution, ExecutionRepositoryError>>;
  findById(id: string): Promise<Result<CronExecution | null, ExecutionRepositoryError>>;
  findByUserId(userId: string, options: ExecutionListOptions): Promise<Result<ListExecutionsResponse, ExecutionRepositoryError>>;
  findByScheduleId(scheduleId: string, options: ExecutionListOptions): Promise<Result<ListExecutionsResponse, ExecutionRepositoryError>>;
  findRunningByScheduleId(scheduleId: string): Promise<Result<CronExecution | null, ExecutionRepositoryError>>;
  update(id: string, updates: Partial<CronExecution>): Promise<Result<CronExecution, ExecutionRepositoryError>>;
}
