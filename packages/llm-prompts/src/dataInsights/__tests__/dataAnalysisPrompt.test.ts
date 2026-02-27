/**
 * Tests for dataAnalysisPrompt builder.
 * Includes F-009 contract and regression tests for Trackable field consistency.
 */

import { describe, it, expect } from 'vitest';
import { dataAnalysisPrompt } from '../dataAnalysisPrompt.js';
import type { DataAnalysisPromptInput } from '../dataAnalysisPrompt.js';
import { parseInsightResponse } from '../parseInsightResponse.js';

const sampleInput: DataAnalysisPromptInput = {
  jsonSchema: { type: 'object', properties: { revenue: { type: 'number' } } },
  snapshotData: { revenue: 10000 },
  chartTypes: [
    { id: 'C1', name: 'Bar', bestFor: 'comparisons', vegaLiteSchema: {} },
    { id: 'C2', name: 'Line', bestFor: 'trends', vegaLiteSchema: {} },
  ],
};

describe('dataAnalysisPrompt', () => {
  it('builds prompt with expected sections', () => {
    const result = dataAnalysisPrompt.build(sampleInput);

    expect(result).toContain('## Your Task');
    expect(result).toContain('## Pipeline Context');
    expect(result).toContain('## Composite Feed Schema');
    expect(result).toContain('## Snapshot Data');
    expect(result).toContain('## Supported Visualization Types');
    expect(result).toContain('## Output Requirements');
    expect(result).toContain('## Example Output');
    expect(result).toContain('RULES:');
  });

  it('includes chart types table in output', () => {
    const result = dataAnalysisPrompt.build(sampleInput);

    expect(result).toContain('C1');
    expect(result).toContain('C2');
    expect(result).toContain('Bar');
    expect(result).toContain('Line');
  });

  it('includes JSON schema and snapshot data', () => {
    const result = dataAnalysisPrompt.build(sampleInput);

    expect(result).toContain('"revenue"');
    expect(result).toContain('10000');
  });

  it('has correct metadata', () => {
    expect(dataAnalysisPrompt.name).toBe('data-analysis');
    expect(dataAnalysisPrompt.description).toBe(
      'Analyzes composite feed data and generates measurable, trackable insights'
    );
    expect(dataAnalysisPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe('F-009 contract: Trackable field consistency', () => {
    it('all INSIGHT_N format lines use Trackable=<metric description>, not chart ID', () => {
      const result = dataAnalysisPrompt.build(sampleInput);

      // Match only template lines (contain angle-bracket placeholders), not example output
      const insightFormatLines = result
        .split('\n')
        .filter(
          (line) => /^INSIGHT_\d+:.*Trackable=/.test(line.trim()) && line.includes('Title=<')
        );

      expect(insightFormatLines.length).toBeGreaterThanOrEqual(2);

      for (const line of insightFormatLines) {
        // Each INSIGHT format line must use Trackable=<metric description>
        expect(line).toContain('Trackable=<metric description>');
        // Must NOT have Trackable=<chart ID from table> — that was the F-009 bug
        expect(line).not.toMatch(/Trackable=<chart ID from table>/);
      }
    });

    it('all INSIGHT_N template lines use ChartType=<chart ID from table>', () => {
      const result = dataAnalysisPrompt.build(sampleInput);

      // Match only template lines (contain angle-bracket placeholders), not example output
      const insightFormatLines = result
        .split('\n')
        .filter(
          (line) => /^INSIGHT_\d+:.*ChartType=/.test(line.trim()) && line.includes('Title=<')
        );

      expect(insightFormatLines.length).toBeGreaterThanOrEqual(2);

      for (const line of insightFormatLines) {
        expect(line).toContain('ChartType=<chart ID from table>');
      }
    });

    it('prompt format matches parser field expectations', () => {
      const result = dataAnalysisPrompt.build(sampleInput);

      // Parser expects: Title, Description, Trackable (metric text), ChartType (valid ID)
      // Verify the format template has exactly these 4 fields in order
      const formatLines = result
        .split('\n')
        .filter((line) => /^INSIGHT_\d+:.*Title=/.test(line.trim()));

      for (const line of formatLines) {
        // Verify field order: Title → Description → Trackable → ChartType
        const titleIdx = line.indexOf('Title=');
        const descIdx = line.indexOf('Description=');
        const trackableIdx = line.indexOf('Trackable=');
        const chartIdx = line.indexOf('ChartType=');

        expect(titleIdx).toBeGreaterThan(-1);
        expect(descIdx).toBeGreaterThan(titleIdx);
        expect(trackableIdx).toBeGreaterThan(descIdx);
        expect(chartIdx).toBeGreaterThan(trackableIdx);
      }
    });
  });

  describe('F-009 regression: Trackable field contradiction eliminated', () => {
    it('parser accepts LLM output following the corrected INSIGHT_2 format', () => {
      // Simulate LLM following the corrected format: Trackable is a metric description
      const llmResponse = [
        'INSIGHT_1: Title=Revenue Growth; Description=Revenue grew 20%. Strong trend.; Trackable=Monthly revenue in USD; ChartType=C1',
        'INSIGHT_2: Title=User Engagement; Description=Engagement up 15%. Sessions increased.; Trackable=Daily active users count; ChartType=C2',
      ].join('\n');

      const result = parseInsightResponse(llmResponse);

      expect(result.insights).toHaveLength(2);
      expect(result.insights[0]?.trackableMetric).toBe('Monthly revenue in USD');
      expect(result.insights[1]?.trackableMetric).toBe('Daily active users count');
    });

    it('detects when LLM incorrectly puts chart ID in Trackable (old bug format)', () => {
      // This is the failure path from the audit: LLM follows old contradictory INSIGHT_2
      // format and puts a chart ID in Trackable instead of a metric description.
      // The parser accepts it (no semantic validation) but the data is wrong.
      // This test documents the known failure path and validates it no longer happens
      // because the prompt format is now consistent.
      const oldBugResponse = [
        'INSIGHT_1: Title=Revenue Growth; Description=Revenue grew 20%. Strong trend.; Trackable=Monthly revenue; ChartType=C1',
        'INSIGHT_2: Title=User Engagement; Description=Engagement up 15%. Sessions increased.; Trackable=C2; ChartType=C2',
      ].join('\n');

      const result = parseInsightResponse(oldBugResponse);

      // Parser accepts C2 as trackable text (no semantic validation),
      // but the value is semantically wrong — it's a chart ID, not a metric.
      // The fix is in the prompt, not the parser, so this documents the failure mode.
      expect(result.insights[1]?.trackableMetric).toBe('C2');

      // Now verify the prompt no longer instructs this contradictory format
      const prompt = dataAnalysisPrompt.build(sampleInput);
      const insightFormatLines = prompt
        .split('\n')
        .filter((line) => /^INSIGHT_\d+:.*Trackable=/.test(line.trim()));

      // No format line should tell the LLM to put chart ID in Trackable
      for (const line of insightFormatLines) {
        expect(line).not.toMatch(/Trackable=<chart ID from table>/);
      }
    });
  });
});
