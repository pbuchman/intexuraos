/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FailedLinearIssue } from '@/types';
import { NeedsAttentionSection } from '../NeedsAttentionSection.js';

afterEach(() => {
  cleanup();
});

const failed: FailedLinearIssue = {
  id: 'f1',
  userId: 'u1',
  actionId: 'a1',
  originalText: 'Original text describing the issue',
  extractedTitle: 'Extracted title',
  extractedPriority: null,
  error: 'Validation failed',
  reasoning: null,
  createdAt: new Date().toISOString(),
};

describe('NeedsAttentionSection', () => {
  it('renders nothing when there are no failed issues', () => {
    const { container } = render(
      <NeedsAttentionSection
        issues={[]}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        deletingId={null}
        retryingId={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows failed issues with header and count', () => {
    render(
      <NeedsAttentionSection
        issues={[failed]}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        deletingId={null}
        retryingId={null}
      />
    );
    expect(screen.getByText('Needs Attention (1)')).toBeTruthy();
    expect(screen.getByText('Extracted title')).toBeTruthy();
    expect(screen.getByText('Validation failed')).toBeTruthy();
  });
});
