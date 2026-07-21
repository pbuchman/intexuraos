import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IntexTestRunHeader } from '../IntexTestRunHeader.js';
import { testRunHeader } from '@/testFixtures/intexAgentTestRuns.js';
import { formatDateTimeCompact } from '@/utils/dateFormat';

describe('IntexTestRunHeader', () => {
  afterEach(cleanup);

  it('renders accessible progress, transport/mock badges, models, duration, and exact costs', () => {
    render(
      <IntexTestRunHeader
        run={testRunHeader({
          lifecycle: 'completed',
          verdict: 'passed',
          updatedAt: '2026-07-20T10:02:05.000Z',
          finishedAt: '2026-07-20T10:02:05.000Z',
        })}
        stale={false}
      />
    );

    expect(screen.getByRole('progressbar', { name: 'Test scenarios completed' })).toHaveAttribute(
      'max',
      '20'
    );
    expect(screen.getByText('REAL MATRIX')).toBeInTheDocument();
    expect(screen.getByText('WHATSAPP')).toBeInTheDocument();
    expect(screen.getByText('MOCKED TOOLS')).toBeInTheDocument();
    expect(screen.getByText(/DeepSeek V4 Flash/)).toBeInTheDocument();
    expect(screen.getByText(/MiniMax M3/)).toBeInTheDocument();
    expect(screen.getByText('Total $0.000000120')).toBeInTheDocument();
    expect(screen.getByText('Selected test run')).toBeInTheDocument();
    expect(screen.getByText('Started').parentElement).toHaveTextContent(
      formatDateTimeCompact('2026-07-20T10:00:00.000Z')
    );
    expect(screen.getByText('Finished').parentElement).toHaveTextContent(
      formatDateTimeCompact('2026-07-20T10:02:05.000Z')
    );
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.queryByText('run_1')).not.toBeInTheDocument();
  });

  it('does not collapse finalizing, verdict, and report failure into one state', () => {
    render(
      <IntexTestRunHeader
        stale
        run={testRunHeader({
          lifecycle: 'completed',
          verdict: 'passed',
          artifactDelivery: {
            status: 'failed',
            failureCode: 'REPORT_PUBLICATION_FAILED',
            updatedAt: '2026-07-20T10:10:00.000Z',
          },
        })}
      />
    );

    expect(screen.getByText('Run passed · Report failed')).toBeInTheDocument();
    expect(screen.getByText('Live updates paused')).toBeInTheDocument();
    expect(screen.getByText('Report publication failed')).toBeInTheDocument();
  });
});
