import { describe, expect, it } from 'vitest';
import {
  buildSynthesisPrompt,
  type SynthesisReport,
  type ExternalReport,
} from '../synthesisPrompt.js';

describe('buildSynthesisPrompt', () => {
  const originalPrompt = 'What are the latest developments in AI?';

  it('includes original prompt in research analyst section', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'AI report content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Original Research Prompt');
    expect(result).toContain(originalPrompt);
  });

  it('includes source attribution instruction with model names', () => {
    const reports: SynthesisReport[] = [
      { model: 'GPT-4', content: 'Content 1' },
      { model: 'Claude', content: 'Content 2' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('Begin with source attribution');
    expect(result).toContain('GPT-4, Claude');
  });

  it('includes external sources in attribution when present', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const externalReports: ExternalReport[] = [
      { model: 'Perplexity', content: 'External content 1' },
      { model: 'Custom Source', content: 'External content 2' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, externalReports);

    expect(result).toContain('external sources: Perplexity, Custom Source');
  });

  it('uses fallback name for external reports without model', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const externalReports: ExternalReport[] = [
      { content: 'Unnamed external content' },
      { model: 'Named Source', content: 'Named content' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, externalReports);

    expect(result).toContain('External 1, Named Source');
  });

  it('formats system reports with model headers', () => {
    const reports: SynthesisReport[] = [
      { model: 'GPT-4', content: 'GPT content here' },
      { model: 'Claude', content: 'Claude content here' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('### GPT-4');
    expect(result).toContain('GPT content here');
    expect(result).toContain('### Claude');
    expect(result).toContain('Claude content here');
  });

  it('includes external reports section when external reports provided', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const externalReports: ExternalReport[] = [
      { model: 'Perplexity', content: 'External analysis' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, externalReports);

    expect(result).toContain('## External LLM Reports');
    expect(result).toContain('External Report 1 (Perplexity)');
    expect(result).toContain('External analysis');
  });

  it('does not include external section when no external reports', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).not.toContain('## External LLM Reports');
  });

  it('includes conflict resolution guidelines when external reports present', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const externalReports: ExternalReport[] = [{ content: 'External content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, externalReports);

    expect(result).toContain('## Conflict Resolution Guidelines');
    expect(result).toContain('Note the discrepancy explicitly');
  });

  it('does not include conflict guidelines without external reports', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).not.toContain('## Conflict Resolution Guidelines');
  });

  it('includes all synthesis task requirements', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('Combines the best insights');
    expect(result).toContain('conflicting information');
    expect(result).toContain('balanced conclusion');
    expect(result).toContain('key sources');
  });

  it('mentions both system and external in task when external present', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const externalReports: ExternalReport[] = [{ content: 'External content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, externalReports);

    expect(result).toContain('(both system and external)');
  });

  it('handles empty reports array', () => {
    const result = buildSynthesisPrompt(originalPrompt, []);

    expect(result).toContain('## Original Research Prompt');
    expect(result).toContain('## System Reports');
  });

  it('handles empty external reports array', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, []);

    expect(result).not.toContain('## External LLM Reports');
  });
});
