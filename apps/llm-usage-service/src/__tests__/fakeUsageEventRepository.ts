import { ok, err, type Result } from '@intexuraos/common-core';
import { decodeCursor, encodeCursor } from '../domain/models/cursor.js';
import type { UsageEvent } from '../domain/models/usageEvent.js';
import type {
  CreateEventResult,
  ListUsageEventsParams,
  ListUsageEventsResult,
  UsageEventRepository,
} from '../domain/repositories/usageEventRepository.js';

export class FakeUsageEventRepository implements UsageEventRepository {
  private readonly events = new Map<string, UsageEvent>();
  private failWith: { code: string; message: string } | null = null;

  async createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }

    if (this.events.has(event.eventId)) {
      return ok({ status: 'duplicate' as const });
    }

    this.events.set(event.eventId, event);
    return ok({ status: 'created' as const });
  }

  async list(params: ListUsageEventsParams): Promise<Result<ListUsageEventsResult, { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }

    const allEvents = Array.from(this.events.values());

    // Filter by time range
    let filtered = allEvents.filter(
      (e) => e.occurredAt >= params.timeRange.from && e.occurredAt <= params.timeRange.to,
    );

    // Apply filters
    if (params.filters !== undefined) {
      const f = params.filters;

      if (f.ownerTypes !== undefined && f.ownerTypes.length > 0) {
        const ownerTypes = f.ownerTypes;
        filtered = filtered.filter((e) => ownerTypes.includes(e.owner.type));
      }
      if (f.ownerIds !== undefined && f.ownerIds.length > 0) {
        const ownerIds = f.ownerIds;
        filtered = filtered.filter((e) => ownerIds.includes(e.owner.id));
      }
      if (f.services !== undefined && f.services.length > 0) {
        const services = f.services;
        filtered = filtered.filter((e) => services.includes(e.source.service));
      }
      if (f.components !== undefined && f.components.length > 0) {
        const components = f.components;
        filtered = filtered.filter((e) => components.includes(e.source.component));
      }
      if (f.clients !== undefined && f.clients.length > 0) {
        const clients = f.clients;
        filtered = filtered.filter((e) => clients.includes(e.source.client));
      }
      if (f.providers !== undefined && f.providers.length > 0) {
        const providers = f.providers;
        filtered = filtered.filter((e) => providers.includes(e.request.provider));
      }
      if (f.models !== undefined && f.models.length > 0) {
        const models = f.models;
        filtered = filtered.filter((e) => models.includes(e.request.model));
      }
      if (f.operations !== undefined && f.operations.length > 0) {
        const operations = f.operations;
        filtered = filtered.filter((e) => operations.includes(e.request.operation));
      }
      if (f.success !== undefined) {
        const success = f.success;
        filtered = filtered.filter((e) => e.request.success === success);
      }
    }

    const totalMatched = filtered.length;

    // Sort
    const sortField = params.sortBy?.field ?? 'occurredAt';
    const sortDirection = params.sortBy?.direction ?? 'desc';
    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

    filtered.sort((a, b) => {
      const aVal = getSortValue(a, sortField);
      const bVal = getSortValue(b, sortField);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      if (cmp !== 0) {
        return cmp * directionMultiplier;
      }
      // Tiebreaker by eventId
      const idCmp = a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
      return idCmp * directionMultiplier;
    });

    // Apply cursor
    if (params.cursor !== undefined) {
      const decoded = decodeCursor(params.cursor);
      if (decoded !== null) {
        const cursorIdx = filtered.findIndex((e) => {
          const val = getSortValue(e, sortField);
          const cursorVal = decoded.lastOccurredAt;
          if (sortDirection === 'desc') {
            return val < cursorVal || (val === cursorVal && e.eventId < decoded.lastEventId);
          }
          return val > cursorVal || (val === cursorVal && e.eventId > decoded.lastEventId);
        });
        if (cursorIdx >= 0) {
          filtered = filtered.slice(cursorIdx);
        } else {
          filtered = [];
        }
      }
    }

    // Paginate
    const pageEvents = filtered.slice(0, params.limit);
    const hasMore = filtered.length > params.limit;

    const result: ListUsageEventsResult = {
      events: pageEvents,
      totalMatched,
    };

    if (hasMore && pageEvents.length > 0) {
      const lastEvent = pageEvents[pageEvents.length - 1];
      if (lastEvent !== undefined) {
        result.nextCursor = encodeCursor(lastEvent.occurredAt, lastEvent.eventId);
      }
    }

    return ok(result);
  }

  async getById(eventId: string): Promise<Result<UsageEvent | null, { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }

    const event = this.events.get(eventId);
    return ok(event ?? null);
  }

  getStoredEvents(): UsageEvent[] {
    return Array.from(this.events.values());
  }

  setFailure(error: { code: string; message: string }): void {
    this.failWith = error;
  }

  clearFailure(): void {
    this.failWith = null;
  }

  clear(): void {
    this.events.clear();
    this.failWith = null;
  }
}

function getSortValue(event: UsageEvent, field: 'occurredAt' | 'costUsd' | 'totalTokens'): string | number {
  switch (field) {
    case 'occurredAt':
      return event.occurredAt;
    case 'costUsd':
      return event.cost.billedUsd;
    case 'totalTokens':
      return event.usage.totalTokens;
  }
}
