import { describe, expect, it } from 'vitest';

import {
  formatTestArtifactDelivery,
  formatTestDuration,
  formatTestModel,
  formatTestNanoUsd,
  formatTestStatus,
  scenarioMatchesTestRunFilters,
} from '../testRunPresentation.js';
import { testScenarioSummary } from '@/testFixtures/intexAgentTestRuns.js';

describe('Test Run presentation', () => {
  it('keeps lifecycle, verdict, and artifact delivery as distinct closed labels', () => {
    expect(formatTestStatus('finalizing')).toBe('Finalizing safely');
    expect(formatTestStatus('not_evaluated')).toBe('Not evaluated');
    expect(
      formatTestArtifactDelivery({
        status: 'unknown',
        failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
        updatedAt: '2026-07-20T10:00:00.000Z',
      })
    ).toBe('Report status unknown');
  });

  it('uses the approved model labels and preserves nullable nano-USD precision', () => {
    expect(formatTestModel('or:deepseek/deepseek-v4-flash')).toBe('DeepSeek V4 Flash');
    expect(formatTestModel('or:minimax/minimax-m3')).toBe('MiniMax M3');
    expect(formatTestNanoUsd(120)).toBe('$0.000000120');
    expect(formatTestNanoUsd(null)).toBe('Unavailable');
    expect(formatTestDuration(125_000)).toBe('2m 5s');
    expect(formatTestDuration(null)).toBe('In progress');
  });

  it('filters only by scenario number, catalog label, lifecycle, verdict, and safe tools', () => {
    const scenario = testScenarioSummary(7, {
      scenarioLabel: 'Create a calendar event',
      lifecycle: 'completed',
      verdict: 'passed',
      selectedTools: ['create_calendar_event'],
    });
    expect(
      scenarioMatchesTestRunFilters(scenario, {
        search: 'calendar',
        lifecycle: 'completed',
        verdict: 'passed',
        tool: 'create_calendar_event',
      })
    ).toBe(true);
    expect(
      scenarioMatchesTestRunFilters(scenario, {
        search: 'private message text',
        lifecycle: 'all',
        verdict: 'all',
        tool: 'all',
      })
    ).toBe(false);
  });
});
