import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IntexTestScenarioTimeline } from '../IntexTestScenarioTimeline.js';
import { testScenarioDto } from '@/testFixtures/intexAgentTestRuns.js';

describe('IntexTestScenarioTimeline', () => {
  afterEach(cleanup);

  it('renders natural messages and distinguishes selection, confirmation, and mock execution', () => {
    render(<IntexTestScenarioTimeline detail={testScenarioDto()} loading={false} />);

    expect(screen.getByText('Create a launch note.')).toBeInTheDocument();
    expect(screen.getByText('The launch note is ready.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tool selected' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mock completed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirmation requested' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('shows the safe session-start lifecycle and reason', () => {
    const fixture = testScenarioDto();
    render(
      <IntexTestScenarioTimeline
        detail={{
          ...fixture,
          eventWatermark: 1,
          timeline: [
            {
              type: 'session_started',
              timelineIndex: 0,
              eventSequence: 1,
              turnIndex: 0,
              startReason: 'user_requested_new_session',
              explicit: true,
              createdAt: '2026-07-20T10:00:00.000Z',
            },
          ],
        }}
        loading={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Session started' })).toBeInTheDocument();
    expect(screen.getByText(/User requested new session/)).toBeInTheDocument();
    expect(screen.getByText(/Explicit start/)).toBeInTheDocument();
  });

  it('renders deterministic checks and one MiniMax card per observed reply', () => {
    render(<IntexTestScenarioTimeline detail={testScenarioDto()} loading={false} />);

    const deterministic = screen.getByRole('article', { name: 'Deterministic evaluation' });
    expect(within(deterministic).getByText('Tool name')).toBeInTheDocument();
    expect(within(deterministic).getAllByText('Passed')).toHaveLength(2);
    expect(within(deterministic).getAllByText(/Expected tool: Create note/i)).toHaveLength(2);
    expect(within(deterministic).getAllByText(/Actual tool: Create note/i)).toHaveLength(2);
    expect(within(deterministic).getByText(/Expected content length: exists/i)).toBeInTheDocument();
    expect(within(deterministic).getByText(/Actual content length: 21/i)).toBeInTheDocument();
    const minimax = screen.getByRole('article', { name: 'Turn 1 · Reply 1 MiniMax evaluation' });
    expect(within(minimax).getByText('MiniMax M3')).toBeInTheDocument();
    expect(within(minimax).getByText('Score 5/5')).toBeInTheDocument();
    expect(within(minimax).getByText('$0.000000020')).toBeInTheDocument();
  });

  it('does not render private identifiers, event sequences, raw payloads, or rationale', () => {
    render(<IntexTestScenarioTimeline detail={testScenarioDto()} loading={false} />);

    expect(screen.queryByText('run_1')).not.toBeInTheDocument();
    expect(screen.queryByText(/eventWatermark|eventSequence|sessionId|rationale|provider/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('intex-test-scenario-timeline')).toHaveClass('min-w-0');
  });

  it('keeps pending evaluation coverage distinct from a not-evaluated verdict', () => {
    const fixture = testScenarioDto();
    render(
      <IntexTestScenarioTimeline
        detail={{
          ...fixture,
          scenario: {
            ...fixture.scenario,
            verdict: 'not_evaluated',
            deterministicVerdict: 'not_evaluated',
            semanticVerdict: 'pending',
          },
          timeline: fixture.timeline.filter(
            (event) =>
              event.type !== 'deterministic_evaluation' && event.type !== 'minimax_evaluation'
          ),
        }}
        loading={false}
      />
    );

    expect(screen.getByText(/Running · Not evaluated/)).toBeInTheDocument();
    expect(screen.getByText('Deterministic: Not evaluated')).toBeInTheDocument();
    expect(screen.getByText('MiniMax: Pending')).toBeInTheDocument();
    expect(screen.getByText('Expected 3 · Observed 1 · Judged 0')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /MiniMax evaluation/ })).not.toBeInTheDocument();
  });
});
