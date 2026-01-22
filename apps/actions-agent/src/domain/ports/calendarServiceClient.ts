import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';

export interface ProcessCalendarRequest {
  action: Action;
}

export type CalendarPreviewStatus = 'pending' | 'ready' | 'failed';

export interface CalendarPreview {
  actionId: string;
  userId: string;
  status: CalendarPreviewStatus;
  summary?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
  duration?: string | null;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
  generatedAt: string;
}

export interface CalendarServiceClient {
  processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>>;
  getPreview(actionId: string): Promise<Result<CalendarPreview | null>>;
}
