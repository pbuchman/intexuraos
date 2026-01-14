import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';

export interface ProcessCalendarRequest {
  action: Action;
}

export interface ProcessCalendarResponse {
  status: 'completed' | 'failed';
  resource_url?: string;
  error?: string;
}

export interface CalendarServiceClient {
  processAction(request: ProcessCalendarRequest): Promise<Result<ProcessCalendarResponse>>;
}
