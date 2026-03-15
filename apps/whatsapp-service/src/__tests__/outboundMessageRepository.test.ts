/**
 * Tests for outboundMessageRepository createOutboundMessage helper.
 */
import { describe, expect, it } from 'vitest';
import { createOutboundMessage } from '../infra/firestore/outboundMessageRepository.js';

describe('createOutboundMessage', () => {
  it('creates outbound message with valid params', () => {
    const result = createOutboundMessage({
      wamid: 'test-wamid',
      correlationId: 'action-deploy-approval-action-123',
      userId: 'user-456',
    });

    expect(result.wamid).toBe('test-wamid');
    expect(result.correlationId).toBe('action-deploy-approval-action-123');
    expect(result.userId).toBe('user-456');
    expect(result.sentAt).toBeDefined();
    expect(result.expiresAt).toBeGreaterThan(0);
  });

  it('sets expiresAt to 7 days from now', () => {
    const before = Date.now();
    const result = createOutboundMessage({
      wamid: 'test-wamid',
      correlationId: 'test-corr',
      userId: 'user-1',
    });
    const after = Date.now();

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expectedMin = Math.floor((before + sevenDaysMs) / 1000);
    const expectedMax = Math.floor((after + sevenDaysMs) / 1000);

    expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it('throws if wamid is empty', () => {
    expect(() =>
      createOutboundMessage({
        wamid: '',
        correlationId: 'test-corr',
        userId: 'user-1',
      })
    ).toThrow('wamid is required');
  });

  it('throws if wamid is whitespace only', () => {
    expect(() =>
      createOutboundMessage({
        wamid: '   ',
        correlationId: 'test-corr',
        userId: 'user-1',
      })
    ).toThrow('wamid is required');
  });

  it('throws if correlationId is empty', () => {
    expect(() =>
      createOutboundMessage({
        wamid: 'test-wamid',
        correlationId: '',
        userId: 'user-1',
      })
    ).toThrow('correlationId is required');
  });

  it('throws if correlationId is whitespace only', () => {
    expect(() =>
      createOutboundMessage({
        wamid: 'test-wamid',
        correlationId: '   ',
        userId: 'user-1',
      })
    ).toThrow('correlationId is required');
  });

  it('throws if userId is empty', () => {
    expect(() =>
      createOutboundMessage({
        wamid: 'test-wamid',
        correlationId: 'test-corr',
        userId: '',
      })
    ).toThrow('userId is required');
  });

  it('throws if userId is whitespace only', () => {
    expect(() =>
      createOutboundMessage({
        wamid: 'test-wamid',
        correlationId: 'test-corr',
        userId: '   ',
      })
    ).toThrow('userId is required');
  });
});
