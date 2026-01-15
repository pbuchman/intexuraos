/**
 * Tests for parseInsightResponse.
 */

import { describe, it, expect } from 'vitest';
import { parseInsightResponse } from '../parseInsightResponse.js';

describe('parseInsightResponse', () => {
  it('parses valid insight response', () => {
    const response = `INSIGHT_1: Title=Sales Trend; Description=Sales increased by 10%; Trackable=Monthly Revenue; ChartType=C1`;

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]?.title).toBe('Sales Trend');
    expect(result.insights[0]?.description).toBe('Sales increased by 10%');
    expect(result.insights[0]?.trackableMetric).toBe('Monthly Revenue');
    expect(result.insights[0]?.suggestedChartType).toBe('C1');
  });

  it('parses multiple insights', () => {
    const response = `INSIGHT_1: Title=Sales Trend; Description=Sales increased; Trackable=Revenue; ChartType=C1
INSIGHT_2: Title=User Growth; Description=Users up 5%; Trackable=Active Users; ChartType=C2`;

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(2);
  });

  it('parses NO_INSIGHTS response', () => {
    const response = 'NO_INSIGHTS: Reason=Insufficient data for analysis';

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(0);
    expect(result.noInsightsReason).toBe('Insufficient data for analysis');
  });

  it('throws on empty response', () => {
    const response = '';

    expect(() => parseInsightResponse(response)).toThrow('Empty response from LLM');
  });

  it('throws on NO_INSIGHTS with multiple lines', () => {
    const response = `NO_INSIGHTS: Reason=Insufficient data
EXTRA_LINE`;

    expect(() => parseInsightResponse(response)).toThrow('must be a single line');
  });

  it('throws on invalid INSIGHT format', () => {
    const response = 'INVALID_FORMAT';

    expect(() => parseInsightResponse(response)).toThrow('Expected INSIGHT_N or NO_INSIGHTS');
  });

  it('throws on missing parts', () => {
    const response = 'INSIGHT_1: Title=Test; Description=Test; Trackable=Test';

    expect(() => parseInsightResponse(response)).toThrow('Expected 4 parts');
  });

  it('throws on malformed Title field', () => {
    const response = 'INSIGHT_1: InvalidTitle; Description=Test; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Title field missing or malformed');
  });

  it('throws on malformed Description field', () => {
    const response = 'INSIGHT_1: Title=Test; InvalidDesc; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Description field missing or malformed');
  });

  it('throws on malformed Trackable field', () => {
    const response = 'INSIGHT_1: Title=Test; Description=Test; InvalidTrackable; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Trackable field missing or malformed');
  });

  it('throws on malformed ChartType field', () => {
    const response = 'INSIGHT_1: Title=Test; Description=Test; Trackable=Test; InvalidChart';

    expect(() => parseInsightResponse(response)).toThrow('ChartType field missing or malformed');
  });

  it('throws on empty Title', () => {
    const response = 'INSIGHT_1: Title=; Description=Test; Trackable=Test; ChartType=C1';

    // Regex requires at least one character, so format error comes first
    expect(() => parseInsightResponse(response)).toThrow('Title field missing or malformed');
  });

  it('throws on empty Description', () => {
    const response = 'INSIGHT_1: Title=Test; Description=; Trackable=Test; ChartType=C1';

    // Regex requires at least one character, so format error comes first
    expect(() => parseInsightResponse(response)).toThrow('Description field missing or malformed');
  });

  it('throws on Description with too many sentences', () => {
    const response =
      'INSIGHT_1: Title=Test; Description=Sentence one. Sentence two. Sentence three. Sentence four. And five.; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Description must be max 3 sentences');
  });

  it('throws on empty Trackable metric', () => {
    const response = 'INSIGHT_1: Title=Test; Description=Test; Trackable=; ChartType=C1';

    // Regex requires at least one character, so format error comes first
    expect(() => parseInsightResponse(response)).toThrow('Trackable field missing or malformed');
  });

  it('throws on invalid ChartType', () => {
    const response = 'INSIGHT_1: Title=Test; Description=Test; Trackable=Test; ChartType=INVALID';

    expect(() => parseInsightResponse(response)).toThrow("Invalid ChartType 'INVALID'");
  });

  it('throws on NO_INSIGHTS with empty reason', () => {
    const response = 'NO_INSIGHTS: Reason=';

    // Regex requires at least one character, so it fails format check first
    expect(() => parseInsightResponse(response)).toThrow('Invalid NO_INSIGHTS format');
  });

  it('throws on NO_INSIGHTS with malformed format', () => {
    const response = 'NO_INSIGHTS: InvalidFormat';

    expect(() => parseInsightResponse(response)).toThrow('Invalid NO_INSIGHTS format');
  });

  it('throws on NO_INSIGHTS with whitespace-only reason', () => {
    const response = 'NO_INSIGHTS: Reason=   ';

    // The regex requires at least one non-whitespace character after trim
    expect(() => parseInsightResponse(response)).toThrow();
  });

  it('throws on insights without INSIGHT_ prefix', () => {
    const response = 'NOT_AN_INSIGHT: Title=Test; Description=Test; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Expected INSIGHT_N or NO_INSIGHTS');
  });

  it('throws when no insights found', () => {
    const response = 'SOME_OTHER_CONTENT';

    expect(() => parseInsightResponse(response)).toThrow('Expected INSIGHT_N or NO_INSIGHTS');
  });

  it('throws on too many insights', () => {
    let response = '';
    for (let i = 1; i <= 6; i++) {
      response += `INSIGHT_${i}: Title=Test ${i}; Description=Test; Trackable=Test; ChartType=C1\n`;
    }

    expect(() => parseInsightResponse(response)).toThrow(
      'Too many insights: expected max 5, got 6'
    );
  });

  it('throws on INSIGHT line with wrong prefix format', () => {
    // Missing colon after INSIGHT_N - triggers line 21 branch (!match)
    const response = 'INSIGHT_1 Title=Test; Description=Test; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Invalid INSIGHT format');
  });

  it('throws on INSIGHT line with missing number', () => {
    // Missing number after INSIGHT_ - triggers line 21 branch (!match)
    const response = 'INSIGHT_: Title=Test; Description=Test; Trackable=Test; ChartType=C1';

    expect(() => parseInsightResponse(response)).toThrow('Invalid INSIGHT format');
  });

  it('handles whitespace trimming around parts', () => {
    const response = `  INSIGHT_1: Title=Sales Trend ; Description=Sales increased ; Trackable=Revenue ; ChartType=C1  `;

    const result = parseInsightResponse(response);

    expect(result.insights[0]?.title).toBe('Sales Trend');
    expect(result.insights[0]?.description).toBe('Sales increased');
    expect(result.insights[0]?.trackableMetric).toBe('Revenue');
  });

  it('handles all valid chart types', () => {
    const validTypes = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
    for (const chartType of validTypes) {
      const response = `INSIGHT_1: Title=Test; Description=Test; Trackable=Test; ChartType=${chartType}`;
      const result = parseInsightResponse(response);
      expect(result.insights[0]?.suggestedChartType).toBe(chartType);
    }
  });

  it('handles description with exactly 3 sentences', () => {
    const response =
      'INSIGHT_1: Title=Test; Description=First sentence. Second sentence. Third sentence.; Trackable=Test; ChartType=C1';

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(1);
  });

  it('handles description with 1 sentence', () => {
    const response =
      'INSIGHT_1: Title=Test; Description=Single sentence.; Trackable=Test; ChartType=C1';

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(1);
  });

  it('handles max 5 insights', () => {
    let response = '';
    for (let i = 1; i <= 5; i++) {
      response += `INSIGHT_${i}: Title=Test ${i}; Description=Test; Trackable=Test; ChartType=C1\n`;
    }

    const result = parseInsightResponse(response);

    expect(result.insights).toHaveLength(5);
  });
});
