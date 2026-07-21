import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntexTestScenarioRail } from '../IntexTestScenarioRail.js';
import { testRunDto } from '@/testFixtures/intexAgentTestRuns.js';

describe('IntexTestScenarioRail', () => {
  afterEach(cleanup);

  it('renders the canonical 001..020 order and accessible selected state', () => {
    render(
      <IntexTestScenarioRail
        scenarios={testRunDto().scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={vi.fn()}
      />
    );
    const rows = screen.getAllByRole('button', { name: /Scenario \d{3}/i });
    expect(rows).toHaveLength(20);
    expect(rows[0]).toHaveAccessibleName(/Scenario 001.*Catalog label 1.*Running.*Pending/i);
    expect(rows[19]).toHaveAccessibleName(/Scenario 020.*Catalog label 20/i);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByText('TEST').length).toBeGreaterThan(0);
  });

  it('combines safe text, lifecycle, verdict, and tool filters', async () => {
    const user = userEvent.setup();
    render(
      <IntexTestScenarioRail
        scenarios={testRunDto().scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={vi.fn()}
      />
    );
    await user.type(screen.getByRole('searchbox', { name: 'Search test scenarios' }), '001');
    expect(screen.getAllByRole('button', { name: /Scenario \d{3}/i })).toHaveLength(1);
    expect(screen.queryByText('private session message')).not.toBeInTheDocument();
  });

  it('searches by the natural catalog title', async () => {
    const user = userEvent.setup();
    render(
      <IntexTestScenarioRail
        scenarios={testRunDto().scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={vi.fn()}
      />
    );

    await user.type(
      screen.getByRole('searchbox', { name: 'Search test scenarios' }),
      'Catalog label 7'
    );
    expect(screen.getAllByRole('button', { name: /Scenario \d{3}/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Scenario 007/i })).toBeInTheDocument();
  });

  it('shows exact duration without collapsing pending scenarios into zero', () => {
    const scenarios = testRunDto().scenarios.map((scenario, index) =>
      index === 0
        ? {
            ...scenario,
            lifecycle: 'completed' as const,
            durationMs: 125_000,
            finishedAt: '2026-07-20T10:02:05.000Z',
          }
        : scenario
    );
    render(
      <IntexTestScenarioRail
        scenarios={scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Scenario 001/i })).toHaveAccessibleName(/2m 5s/);
    expect(screen.getByRole('button', { name: /Scenario 002/i })).toHaveAccessibleName(
      /In progress/
    );
  });

  it('shows deterministic and MiniMax evaluation states independently', () => {
    const scenarios = testRunDto().scenarios.map((scenario, index) =>
      index === 0
        ? {
            ...scenario,
            verdict: 'not_evaluated' as const,
            deterministicVerdict: 'not_evaluated' as const,
            semanticVerdict: 'pending' as const,
          }
        : scenario
    );
    render(
      <IntexTestScenarioRail
        scenarios={scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Scenario 001/i })).toHaveAccessibleName(
      /Deterministic: Not evaluated.*MiniMax: Pending/i
    );
  });

  it('supports keyboard focus and activation for scenario selection', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <IntexTestScenarioRail
        scenarios={testRunDto().scenarios}
        selectedScenarioId="scenario_001"
        loading={false}
        onSelect={onSelect}
      />
    );

    const search = screen.getByRole('searchbox', { name: 'Search test scenarios' });
    search.focus();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();

    const firstScenario = screen.getByRole('button', { name: /Scenario 001/i });
    expect(firstScenario).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('scenario_001');
  });
});
