import { describe, expect, it, vi } from 'vitest';
import { sendChatError } from '../routes/chatRouteErrors.js';

function createReply(): {
  fail: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  return {
    fail: vi.fn().mockReturnValue('failed'),
    status: vi.fn().mockReturnValue({
      send: vi.fn().mockReturnValue('sent'),
    }),
  };
}

describe('sendChatError', () => {
  it('maps repository and use-case errors to HTTP replies', () => {
    const reply = createReply();

    expect(sendChatError(reply as never, { code: 'NOT_FOUND', message: 'missing' })).toBe('failed');
    expect(sendChatError(reply as never, { code: 'DOWNSTREAM_ERROR', message: 'down' })).toBe('failed');
    expect(sendChatError(reply as never, { code: 'FIRESTORE_ERROR', message: 'db' })).toBe('failed');
    expect(sendChatError(reply as never, {
      code: 'CITATION_VALIDATION_FAILED',
      message: 'bad cite',
    })).toBe('failed');
    expect(sendChatError(reply as never, { code: 'NO_API_KEY', message: 'missing key' })).toBe('sent');

    expect(reply.fail).toHaveBeenCalledWith('NOT_FOUND', 'missing');
    expect(reply.fail).toHaveBeenCalledWith('DOWNSTREAM_ERROR', 'down');
    expect(reply.fail).toHaveBeenCalledWith('INTERNAL_ERROR', 'db');
    expect(reply.fail).toHaveBeenCalledWith('INTERNAL_ERROR', 'bad cite');
    expect(reply.status).toHaveBeenCalledWith(400);
  });
});
