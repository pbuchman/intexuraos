import { describe, it, expect } from 'vitest';
import { buildApprovalButtons } from '../../../domain/utils/approvalButtons.js';

describe('buildApprovalButtons', () => {
  it('returns approve and reject buttons with action ID', () => {
    const buttons = buildApprovalButtons({ actionId: 'action-123' });

    expect(buttons).toEqual([
      {
        type: 'reply',
        reply: { id: 'approve:action-123', title: 'Approve' },
      },
      {
        type: 'reply',
        reply: { id: 'reject:action-123', title: 'Reject' },
      },
    ]);
  });

  it('appends extra buttons when provided', () => {
    const buttons = buildApprovalButtons({
      actionId: 'action-456',
      extraButtons: [
        {
          type: 'reply',
          reply: { id: 'convert:action-456', title: 'Convert to Issue' },
        },
      ],
    });

    expect(buttons).toHaveLength(3);
    expect(buttons[2]).toEqual({
      type: 'reply',
      reply: { id: 'convert:action-456', title: 'Convert to Issue' },
    });
  });

  it('returns only approve and reject when extraButtons is undefined', () => {
    const buttons = buildApprovalButtons({ actionId: 'abc' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.reply.id).toBe('approve:abc');
    expect(buttons[1]?.reply.id).toBe('reject:abc');
  });
});
