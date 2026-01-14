/**
 * Test fakes for calendar-agent.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  CalendarError,
  CalendarEvent,
  CreateEventInput,
  FailedEvent,
  CreateFailedEventInput,
  FailedEventFilters,
  FreeBusyInput,
  FreeBusySlot,
  GoogleCalendarClient,
  ListEventsInput,
  OAuthTokenResult,
  UpdateEventInput,
  UserServiceClient,
} from '../domain/index.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LLMError } from '@intexuraos/llm-contract';
import type {
  CalendarActionExtractionService,
  ExtractedCalendarEvent,
  ExtractionError,
} from '../infra/gemini/calendarActionExtractionService.js';

export class FakeUserServiceClient implements UserServiceClient {
  private tokenResult: Result<OAuthTokenResult, CalendarError> | null = null;

  setTokenResult(result: Result<OAuthTokenResult, CalendarError>): void {
    this.tokenResult = result;
  }

  setTokenSuccess(accessToken: string, email: string): void {
    this.tokenResult = ok({ accessToken, email });
  }

  setTokenError(code: CalendarError['code'], message: string): void {
    this.tokenResult = err({ code, message });
  }

  async getOAuthToken(_userId: string): Promise<Result<OAuthTokenResult, CalendarError>> {
    if (this.tokenResult === null) {
      return ok({ accessToken: 'test-access-token', email: 'test@example.com' });
    }
    return this.tokenResult;
  }
}

export class FakeGoogleCalendarClient implements GoogleCalendarClient {
  private events: CalendarEvent[] = [];
  private listResult: Result<CalendarEvent[], CalendarError> | null = null;
  private getResult: Result<CalendarEvent, CalendarError> | null = null;
  private createResult: Result<CalendarEvent, CalendarError> | null = null;
  private updateResult: Result<CalendarEvent, CalendarError> | null = null;
  private deleteResult: Result<void, CalendarError> | null = null;
  private freeBusyResult: Result<Map<string, FreeBusySlot[]>, CalendarError> | null = null;

  addEvent(event: CalendarEvent): void {
    this.events.push(event);
  }

  setListResult(result: Result<CalendarEvent[], CalendarError>): void {
    this.listResult = result;
  }

  setGetResult(result: Result<CalendarEvent, CalendarError>): void {
    this.getResult = result;
  }

  setCreateResult(result: Result<CalendarEvent, CalendarError>): void {
    this.createResult = result;
  }

  setUpdateResult(result: Result<CalendarEvent, CalendarError>): void {
    this.updateResult = result;
  }

  setDeleteResult(result: Result<void, CalendarError>): void {
    this.deleteResult = result;
  }

  setFreeBusyResult(result: Result<Map<string, FreeBusySlot[]>, CalendarError>): void {
    this.freeBusyResult = result;
  }

  async listEvents(
    _accessToken: string,
    _calendarId: string,
    _options: ListEventsInput,
    _logger?: unknown
  ): Promise<Result<CalendarEvent[], CalendarError>> {
    if (this.listResult !== null) {
      return this.listResult;
    }
    return ok(this.events);
  }

  async getEvent(
    _accessToken: string,
    _calendarId: string,
    eventId: string,
    _logger?: unknown
  ): Promise<Result<CalendarEvent, CalendarError>> {
    if (this.getResult !== null) {
      return this.getResult;
    }
    const event = this.events.find((e) => e.id === eventId);
    if (event === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    return ok(event);
  }

  async createEvent(
    _accessToken: string,
    _calendarId: string,
    event: CreateEventInput,
    _logger?: unknown
  ): Promise<Result<CalendarEvent, CalendarError>> {
    if (this.createResult !== null) {
      return this.createResult;
    }
    const newEvent: CalendarEvent = {
      id: `event-${Date.now()}`,
      summary: event.summary,
      start: event.start,
      end: event.end,
    };
    if (event.description !== undefined) {
      newEvent.description = event.description;
    }
    if (event.location !== undefined) {
      newEvent.location = event.location;
    }
    this.events.push(newEvent);
    return ok(newEvent);
  }

  async updateEvent(
    _accessToken: string,
    _calendarId: string,
    eventId: string,
    updates: UpdateEventInput,
    _logger?: unknown
  ): Promise<Result<CalendarEvent, CalendarError>> {
    if (this.updateResult !== null) {
      return this.updateResult;
    }
    const eventIndex = this.events.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      return err({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    const event = this.events[eventIndex];
    if (event === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    const updated: CalendarEvent = {
      ...event,
      summary: updates.summary ?? event.summary,
    };
    if (updates.description !== undefined) {
      updated.description = updates.description;
    }
    if (updates.location !== undefined) {
      updated.location = updates.location;
    }
    if (updates.start !== undefined) {
      updated.start = updates.start;
    }
    if (updates.end !== undefined) {
      updated.end = updates.end;
    }
    this.events[eventIndex] = updated;
    return ok(updated);
  }

  async deleteEvent(
    _accessToken: string,
    _calendarId: string,
    eventId: string,
    _logger?: unknown
  ): Promise<Result<void, CalendarError>> {
    if (this.deleteResult !== null) {
      return this.deleteResult;
    }
    const eventIndex = this.events.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      return err({ code: 'NOT_FOUND', message: 'Event not found' });
    }
    this.events.splice(eventIndex, 1);
    return ok(undefined);
  }

  async getFreeBusy(
    _accessToken: string,
    _input: FreeBusyInput,
    _logger?: unknown
  ): Promise<Result<Map<string, FreeBusySlot[]>, CalendarError>> {
    if (this.freeBusyResult !== null) {
      return this.freeBusyResult;
    }
    return ok(new Map([['primary', []]]));
  }
}

export class FakeFailedEventRepository {
  private events: FailedEvent[] = [];
  private createResult: Result<FailedEvent, CalendarError> | null = null;
  private listResult: Result<FailedEvent[], CalendarError> | null = null;
  private getResult: Result<FailedEvent | null, CalendarError> | null = null;
  private deleteResult: Result<void, CalendarError> | null = null;

  setCreateResult(result: Result<FailedEvent, CalendarError>): void {
    this.createResult = result;
  }

  setListResult(result: Result<FailedEvent[], CalendarError>): void {
    this.listResult = result;
  }

  setGetResult(result: Result<FailedEvent | null, CalendarError>): void {
    this.getResult = result;
  }

  setDeleteResult(result: Result<void, CalendarError>): void {
    this.deleteResult = result;
  }

  clear(): void {
    this.events = [];
  }

  getEvents(): FailedEvent[] {
    return [...this.events];
  }

  async create(
    input: CreateFailedEventInput
  ): Promise<Result<FailedEvent, CalendarError>> {
    if (this.createResult !== null) {
      return this.createResult;
    }
    const newEvent: FailedEvent = {
      id: `failed-${Date.now()}`,
      userId: input.userId,
      actionId: input.actionId,
      originalText: input.originalText,
      summary: input.summary,
      start: input.start,
      end: input.end,
      location: input.location,
      description: input.description,
      error: input.error,
      reasoning: input.reasoning,
      createdAt: new Date(),
    };
    this.events.push(newEvent);
    return ok(newEvent);
  }

  async list(
    userId: string,
    _filters?: FailedEventFilters
  ): Promise<Result<FailedEvent[], CalendarError>> {
    if (this.listResult !== null) {
      return this.listResult;
    }
    const userEvents = this.events.filter((e) => e.userId === userId);
    return ok(userEvents);
  }

  async get(id: string): Promise<Result<FailedEvent | null, CalendarError>> {
    if (this.getResult !== null) {
      return this.getResult;
    }
    const event = this.events.find((e) => e.id === id);
    return ok(event ?? null);
  }

  async delete(id: string): Promise<Result<void, CalendarError>> {
    if (this.deleteResult !== null) {
      return this.deleteResult;
    }
    const index = this.events.findIndex((e) => e.id === id);
    if (index === -1) {
      return err({ code: 'NOT_FOUND', message: 'Failed event not found' });
    }
    this.events.splice(index, 1);
    return ok(undefined);
  }
}

export class FakeLlmGenerateClient implements LlmGenerateClient {
  private generateResult: Result<
    { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } },
    LLMError
  > | null = null;

  setGenerateResult(
    result: Result<
      { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } },
      LLMError
    >
  ): void {
    this.generateResult = result;
  }

  async generate(
    _prompt: string
  ): Promise<
    Result<
      { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } },
      LLMError
    >
  > {
    if (this.generateResult !== null) {
      return this.generateResult;
    }
    return ok({
      content: JSON.stringify({
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Test reasoning',
      }),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
    });
  }
}

export class FakeCalendarActionExtractionService implements CalendarActionExtractionService {
  extractEventResult: Result<ExtractedCalendarEvent, ExtractionError> | null = null;

  async extractEvent(
    _userId: string,
    _text: string,
    _currentDate: string
  ): Promise<Result<ExtractedCalendarEvent, ExtractionError>> {
    if (this.extractEventResult !== null) {
      return this.extractEventResult;
    }
    return ok({
      summary: 'Test Event',
      start: '2025-01-15T10:00:00',
      end: '2025-01-15T11:00:00',
      location: null,
      description: null,
      valid: true,
      error: null,
      reasoning: 'Test reasoning',
    });
  }
}
