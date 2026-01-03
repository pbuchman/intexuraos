import { describe, expect, it } from 'vitest';
import {
  buildSynthesisPrompt,
  type SynthesisReport,
  type AdditionalSource,
} from '../synthesisPrompt.js';

describe('buildSynthesisPrompt', () => {
  const originalPrompt = 'What are the latest developments in AI?';

  it('includes original prompt section', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'AI report content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Original Prompt');
    expect(result).toContain(originalPrompt);
  });

  it('includes sources used section with model names', () => {
    const reports: SynthesisReport[] = [
      { model: 'GPT-4', content: 'Content 1' },
      { model: 'Claude', content: 'Content 2' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Sources Used');
    expect(result).toContain('GPT-4, Claude');
  });

  it('includes additional sources in sources used section', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [
      { label: 'Perplexity', content: 'External content 1' },
      { label: 'Custom Source', content: 'External content 2' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('**Additional sources**: Perplexity, Custom Source');
  });

  it('uses fallback name for additional sources without label', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [
      { content: 'Unnamed content' },
      { label: 'Named Source', content: 'Named content' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('Source 1, Named Source');
  });

  it('formats LLM reports with model headers', () => {
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

  it('includes additional sources section when additional sources provided', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [
      { label: 'Perplexity', content: 'External analysis' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('## Additional Sources');
    expect(result).toContain('### Perplexity');
    expect(result).toContain('External analysis');
  });

  it('does not include additional sources section when no additional sources', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).not.toContain('## Additional Sources');
  });

  it('includes conflict resolution guidelines when additional sources present', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [{ content: 'Additional content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('## Conflict Resolution Guidelines');
    expect(result).toContain('Note the discrepancy explicitly');
  });

  it('does not include conflict guidelines without additional sources', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).not.toContain('## Conflict Resolution Guidelines');
  });

  it('includes all synthesis task requirements', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('Combine insights');
    expect(result).toContain('Handle conflicts');
    expect(result).toContain('balanced summary');
  });

  it('mentions both LLM reports and additional sources in task when additional sources present', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [{ content: 'Additional content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('(both LLM reports and additional sources)');
  });

  it('handles empty reports array', () => {
    const result = buildSynthesisPrompt(originalPrompt, []);

    expect(result).toContain('## Original Prompt');
    expect(result).toContain('## LLM Reports');
  });

  it('handles empty additional sources array', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports, []);

    expect(result).not.toContain('## Additional Sources');
  });

  it('includes inline citation rules with example', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Citation Rules (CRITICAL)');
    expect(result).toContain('Inline citations');
    expect(result).toContain('Teide volcano');
  });

  it('includes language requirement', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Language Requirement');
    expect(result).toContain('SAME LANGUAGE');
  });

  it('includes adaptive behavior section', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('## Adaptive Behavior');
    expect(result).toContain('Travel/lifestyle');
    expect(result).toContain('Technical/programming');
    expect(result).toContain('Medical/health');
  });
});
