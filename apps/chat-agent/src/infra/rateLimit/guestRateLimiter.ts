/**
 * In-memory rate limiter for guest chat sessions.
 * Tracks message count per session with hourly window.
 * Bounded by an LRU cap so unbounded session-id rotation cannot leak memory.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

interface GuestUsage {
  count: number;
  windowStart: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PER_HOUR = 100;
const DEFAULT_MAX_SESSIONS = 50_000;

export interface GuestRateLimiter {
  check(sessionId: string): Result<void, { message: string }>;
  record(sessionId: string): void;
  getUsage(sessionId: string): { count: number; remaining: number } | null;
}

export interface GuestRateLimiterConfig {
  maxPerHour?: number;
  maxSessions?: number;
}

export function createGuestRateLimiter(config?: GuestRateLimiterConfig): GuestRateLimiter {
  const maxPerHour = config?.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  const maxSessions = config?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  // Map preserves insertion order — the first key is the oldest. Re-insert on
  // update to mark a key as most-recently-used.
  const usage = new Map<string, GuestUsage>();

  function touch(sessionId: string, entry: GuestUsage): void {
    usage.delete(sessionId);
    usage.set(sessionId, entry);
    while (usage.size > maxSessions) {
      const oldest = usage.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      usage.delete(oldest);
    }
  }

  return {
    check(sessionId: string): Result<void, { message: string }> {
      const now = Date.now();
      const entry = usage.get(sessionId);

      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        return ok(undefined);
      }

      if (entry.count >= maxPerHour) {
        const resetInMs = entry.windowStart + HOUR_MS - now;
        const resetInMinutes = Math.ceil(resetInMs / 60000);
        return err({
          message: `Rate limit exceeded. Try again in ${String(resetInMinutes)} minutes.`,
        });
      }

      return ok(undefined);
    },

    record(sessionId: string): void {
      const now = Date.now();
      const entry = usage.get(sessionId);

      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        touch(sessionId, { count: 1, windowStart: now });
      } else {
        entry.count++;
        touch(sessionId, entry);
      }
    },

    getUsage(sessionId: string): { count: number; remaining: number } | null {
      const now = Date.now();
      const entry = usage.get(sessionId);

      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        return { count: 0, remaining: maxPerHour };
      }

      return { count: entry.count, remaining: Math.max(0, maxPerHour - entry.count) };
    },
  };
}
