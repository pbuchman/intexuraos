import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntexTestRunSelector } from '../IntexTestRunSelector.js';
import { testRunHeader } from '@/testFixtures/intexAgentTestRuns.js';

describe('IntexTestRunSelector', () => {
  afterEach(cleanup);

  it('renders the bounded retained slots and selects without exposing run IDs', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <IntexTestRunSelector
        runs={[
          testRunHeader(),
          testRunHeader({
            runId: 'run_2',
            lifecycle: 'completed',
            verdict: 'passed',
            artifactDelivery: {
              status: 'ready',
              failureCode: null,
              updatedAt: '2026-07-20T10:10:00.000Z',
            },
          }),
        ]}
        selectedRunId="run_1"
        loading={false}
        loadFailed={false}
        onSelect={onSelect}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Completed.*Passed/i }));
    expect(onSelect).toHaveBeenCalledWith('run_2');
    expect(screen.queryByText(/run_[12]/)).not.toBeInTheDocument();
  });

  it('renders the protected empty state without a start control', () => {
    render(
      <IntexTestRunSelector runs={[]} loading={false} loadFailed={false} onSelect={vi.fn()} selectedRunId={undefined} />
    );
    expect(screen.getByText('No test runs yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
  });

  it('does not present a failed discovery request as a genuine empty collection', () => {
    render(
      <IntexTestRunSelector runs={[]} loading={false} loadFailed onSelect={vi.fn()} selectedRunId={undefined} />
    );

    expect(screen.queryByText('No test runs yet')).not.toBeInTheDocument();
  });
});
