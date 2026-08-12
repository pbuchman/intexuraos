/**
 * Test fixtures for usage logging.
 * Provides mock UsageSink for tests.
 */

import type { UsageLogParams } from './usageLogger.js';
import { UsageSink } from './usageLogger.js';

/**
 * Snapshot of a usage event captured by {@link FakeUsageSink}.
 */
export type FakeUsageSinkRecord = UsageLogParams;

/**
 * In-memory UsageSink for tests. Captures every log call in a mutable array
 * so tests can assert usage tracking behavior without real HTTP traffic.
 *
 * @example
 * ```ts
 * const sink = new FakeUsageSink();
 * const client = createOpenRouterClient({ ..., usageSink: sink });
 * await client.generate('hello');
 * expect(sink.records).toHaveLength(1);
 * expect(sink.records[0].callType).toBe('generate');
 * ```
 */
export class FakeUsageSink extends UsageSink {
  readonly records: FakeUsageSinkRecord[] = [];

  override log(params: UsageLogParams): Promise<void> {
    this.records.push(params);
    return Promise.resolve();
  }

  /** Clear captured records between test cases. */
  clear(): void {
    this.records.length = 0;
  }
}

/**
 * Create a {@link FakeUsageSink} instance. Convenience helper for tests that
 * prefer a factory function over `new`.
 */
export function createFakeUsageSink(): FakeUsageSink {
  return new FakeUsageSink();
}
