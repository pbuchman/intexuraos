/**
 * Tests for WatchStatusCard component.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WatchStatusCard } from '../WatchStatusCard.js';
import type { MergeQueueWatch } from '@/types';

// Mock lucide-react icons to simple spans
vi.mock('lucide-react', () => ({
  AlertCircle: (): React.JSX.Element => <span data-testid="icon-alert-circle" />,
  CheckCircle2: (): React.JSX.Element => <span data-testid="icon-check-circle" />,
  Loader2: (): React.JSX.Element => <span data-testid="icon-loader" />,
  XCircle: (): React.JSX.Element => <span data-testid="icon-x-circle" />,
}));

function makeWatch(overrides: Partial<MergeQueueWatch> = {}): MergeQueueWatch {
  return {
    watchId: 'w-1',
    owner: 'test',
    repo: 'repo',
    baseBranch: 'main',
    status: 'active',
    mergedPrs: [],
    skippedPrs: [],
    excludedPrNumbers: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastTickAt: null,
    drainedAt: null,
    ...overrides,
  };
}

describe('WatchStatusCard', () => {
  const noop = (): void => { /* no-op */ };

  it('renders cancelled state with partial merge data', () => {
    const watch = makeWatch({
      status: 'cancelled',
      mergedPrs: [
        { prNumber: 10, title: 'PR A', author: 'alice', mergedAt: '2026-01-01T01:00:00Z' },
        { prNumber: 11, title: 'PR B', author: 'bob', mergedAt: '2026-01-01T02:00:00Z' },
        { prNumber: 12, title: 'PR C', author: 'carol', mergedAt: '2026-01-01T03:00:00Z' },
      ],
      skippedPrs: [
        { prNumber: 13, reason: 'merge_conflict' },
        { prNumber: 14, reason: 'checks_failing' },
      ],
    });

    const html = renderToStaticMarkup(
      <WatchStatusCard watch={watch} onToggle={noop} isToggling={false} blocked={false} excludedCount={0} />,
    );

    // Verify "Cancelled" label is displayed
    expect(html).toContain('Cancelled');

    // Verify partial merge data is shown
    expect(html).toContain('Merged: 3');
    expect(html).toContain('Skipped: 2');

    // Verify amber styling (cancelled state uses amber palette)
    expect(html).toContain('amber');

    // Verify XCircle icon is rendered
    expect(html).toContain('icon-x-circle');
  });

  it('renders toggle when watch is null', () => {
    const html = renderToStaticMarkup(
      <WatchStatusCard watch={null} onToggle={noop} isToggling={false} blocked={false} excludedCount={0} />,
    );

    // Should show the toggle with "Auto-merge" label
    expect(html).toContain('Auto-merge');
    expect(html).toContain('role="switch"');

    // Should NOT show any status card content
    expect(html).not.toContain('Cancelled');
    expect(html).not.toContain('Drained');
    expect(html).not.toContain('Active');
  });

  it('shows excluded count in active watch when excludedCount > 0', () => {
    const watch = makeWatch({ status: 'active' });

    const html = renderToStaticMarkup(
      <WatchStatusCard watch={watch} onToggle={noop} isToggling={false} blocked={false} excludedCount={3} />,
    );

    expect(html).toContain('Excluded: 3');
  });

  it('shows excluded count in error-state watch when excludedCount > 0', () => {
    const watch = makeWatch({ status: 'active', lastError: 'Merge conflict detected', lastErrorAt: '2026-03-25T12:00:00Z' });

    const html = renderToStaticMarkup(
      <WatchStatusCard watch={watch} onToggle={noop} isToggling={false} blocked={false} excludedCount={3} />,
    );

    expect(html).toContain('Active — Error');
    expect(html).toContain('Excluded: 3');
    expect(html).toContain('Merge conflict detected');
  });

  it('hides excluded count when excludedCount is 0', () => {
    const watch = makeWatch({ status: 'active' });

    const html = renderToStaticMarkup(
      <WatchStatusCard watch={watch} onToggle={noop} isToggling={false} blocked={false} excludedCount={0} />,
    );

    expect(html).not.toContain('Excluded');
  });
});
