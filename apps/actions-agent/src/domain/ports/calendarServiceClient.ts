import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';

export interface ProcessCalendarRequest {
  action: Action;
}

export interface CalendarServiceClient {
  processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>>;
}
