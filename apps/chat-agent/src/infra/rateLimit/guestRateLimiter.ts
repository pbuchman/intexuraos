/**
 * In-memory rate limiter for guest chat sessions.
 * Tracks message count per session with hourly window.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

interface GuestUsage {
  count: number;
  windowStart: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PER_HOUR = 100;

export interface GuestRateLimiter {
  check(sessionId: string): Result<void, { message: string }>;
  record(sessionId: string): void;
  getUsage(sessionId: string): { count: number; remaining: number } | null;
}

export interface GuestRateLimiterConfig {
  maxPerHour?: number;
}

export function createGuestRateLimiter(config?: GuestRateLimiterConfig): GuestRateLimiter {
  const maxPerHour = config?.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  const usage = new Map<string, GuestUsage>();

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
        usage.set(sessionId, { count: 1, windowStart: now });
      } else {
        entry.count++;
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
