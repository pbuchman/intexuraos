/**
 * Logger integration tests for chat-agent.
 */
import { describe, it, expect } from 'vitest';
import { createAppLogger } from '@intexuraos/infra-sentry';

describe('chat-agent logger', () => {
  it('should use Sentry integration from @intexuraos/infra-sentry', () => {
    const logger = createAppLogger({ name: 'chat-agent-test' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
