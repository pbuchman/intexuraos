import { describe, it, expect } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import { createApprovalMessage } from './approvalMessage.js';
import type { ActionType } from './action.js';

describe('createApprovalMessage', () => {
  const validParams = {
    wamid: 'wamid.abc123',
    actionId: 'action_001',
    userId: 'user_001',
    actionType: 'note' as ActionType,
    actionTitle: 'Test Note',
  };

  it('returns correct structure with valid params', () => {
    const result = createApprovalMessage(validParams);

    expect(result.wamid).toBe('wamid.abc123');
    expect(result.actionId).toBe('action_001');
    expect(result.userId).toBe('user_001');
    expect(result.actionType).toBe('note');
    expect(result.actionTitle).toBe('Test Note');
    expect(result.id).toBeDefined();
    expect(result.sentAt).toBeDefined();
  });

  it('throws when wamid is empty string', () => {
    expect(() =>
      createApprovalMessage({ ...validParams, wamid: '' })
    ).toThrow('wamid is required');
  });

  it('throws when wamid is whitespace only', () => {
    expect(() =>
      createApprovalMessage({ ...validParams, wamid: '   ' })
    ).toThrow('wamid is required');
  });

  it('throws when actionId is empty string', () => {
    expect(() =>
      createApprovalMessage({ ...validParams, actionId: '' })
    ).toThrow('actionId is required');
  });

  it('throws when userId is empty string', () => {
    expect(() =>
      createApprovalMessage({ ...validParams, userId: '' })
    ).toThrow('userId is required');
  });

  it('throws IntexuraOSError with INVALID_REQUEST/400 for missing fields', () => {
    try {
      createApprovalMessage({ ...validParams, wamid: '' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(IntexuraOSError);
      expect((e as IntexuraOSError).code).toBe('INVALID_REQUEST');
      expect((e as IntexuraOSError).httpStatus).toBe(400);
    }
  });
});
