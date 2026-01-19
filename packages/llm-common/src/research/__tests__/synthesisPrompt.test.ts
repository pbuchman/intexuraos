import { describe, expect, it } from 'vitest';
import {
  buildSynthesisPrompt,
  type ExternalReport,
  type SynthesisReport,
  type AdditionalSource,
} from '../synthesisPrompt.js';
import type { SynthesisContext } from '../../synthesis/contextTypes.js';

const createTestSynthesisContext = (overrides?: Partial<SynthesisContext>): SynthesisContext => ({
  language: 'en',
  domain: 'technical',
  mode: 'standard',
  synthesis_goals: ['merge', 'summarize'],
  missing_sections: [],
  detected_conflicts: [],
  source_preference: {
    prefer_official_over_aggregators: true,
    prefer_recent_when_time_sensitive: false,
  },
  defaults_applied: [],
  assumptions: [],
  output_format: {
    wants_table: false,
    wants_actionable_summary: true,
  },
  safety: {
    high_stakes: false,
    required_disclaimers: [],
  },
  red_flags: [],
  ...overrides,
});

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

  it('formats LLM reports with source ID headers', () => {
    const reports: SynthesisReport[] = [
      { model: 'GPT-4', content: 'GPT content here' },
      { model: 'Claude', content: 'Claude content here' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('### S1 (LLM report; model: GPT-4)');
    expect(result).toContain('GPT content here');
    expect(result).toContain('### S2 (LLM report; model: Claude)');
    expect(result).toContain('Claude content here');
  });

  it('includes additional sources section when additional sources provided', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [
      { label: 'Perplexity', content: 'External analysis' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('## Additional Sources');
    expect(result).toContain('### U1 (Additional source; label: Perplexity)');
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

  it('includes Source ID Map section (not as ## heading)', () => {
    const reports: SynthesisReport[] = [
      { model: 'GPT-4', content: 'Content 1' },
      { model: 'Claude', content: 'Content 2' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('SOURCE ID MAP (for Attribution)');
    expect(result).toContain('S1   | LLM  | GPT-4');
    expect(result).toContain('S2   | LLM  | Claude');
    expect(result).not.toContain('## SOURCE ID MAP');
  });

  it('includes Source ID Map with additional sources', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const additionalSources: AdditionalSource[] = [
      { label: 'Wikipedia', content: 'Wiki content' },
      { label: 'Custom', content: 'Custom content' },
    ];
    const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

    expect(result).toContain('S1   | LLM  | GPT-4');
    expect(result).toContain('U1   | User | Wikipedia');
    expect(result).toContain('U2   | User | Custom');
  });

  it('includes Attribution Rules section', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('ATTRIBUTION RULES (CRITICAL)');
    expect(result).toContain('Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false');
    expect(result).toContain('Primary: Sources providing the main content');
    expect(result).toContain('Secondary: Sources providing supporting information');
    expect(result).toContain('Constraints: Sources that mention limitations');
  });

  it('includes DO NOT output breakdown instruction', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain("DO NOT output a 'Source Utilization Breakdown' section");
  });

  it('includes attribution task in Your Task list', () => {
    const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
    const result = buildSynthesisPrompt(originalPrompt, reports);

    expect(result).toContain('**Attribute sources**: End each ## section with an Attribution line');
  });

  describe('with SynthesisContext', () => {
    it('includes synthesis goals from context', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        synthesis_goals: ['merge', 'conflict_audit', 'rank_recommendations'],
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Synthesis Goals');
      expect(result).toContain('MERGE');
      expect(result).toContain('CONFLICT AUDIT');
      expect(result).toContain('RANK RECOMMENDATIONS');
    });

    it('includes detected conflicts from context', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        detected_conflicts: [
          {
            topic: 'Pricing information',
            sources_involved: ['GPT-4', 'Claude'],
            conflict_summary: 'Different prices reported',
            severity: 'high',
          },
        ],
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Detected Conflicts to Address');
      expect(result).toContain('Pricing information');
      expect(result).toContain('HIGH');
      expect(result).toContain('Different prices reported');
    });

    it('includes missing sections from context', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        missing_sections: ['Budget breakdown', 'Timeline'],
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Missing Coverage');
      expect(result).toContain('Budget breakdown');
      expect(result).toContain('Timeline');
    });

    it('includes safety section when high stakes', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        safety: {
          high_stakes: true,
          required_disclaimers: ['Consult a medical professional'],
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('HIGH-STAKES');
      expect(result).toContain('Consult a medical professional');
    });

    it('includes red flags from context', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        red_flags: ['Potential outdated information'],
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Concerns to Address');
      expect(result).toContain('Potential outdated information');
    });

    it('includes source preference guidelines', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        source_preference: {
          prefer_official_over_aggregators: true,
          prefer_recent_when_time_sensitive: true,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Source Preference Strategy');
      expect(result).toContain('Prefer official sources');
      expect(result).toContain('Prefer more recent sources');
    });

    it('includes language requirement from context', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({ language: 'es' });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Language Requirement');
      expect(result).toContain('ES');
    });

    it('works with additional sources', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext();
      const additionalSources: AdditionalSource[] = [
        { label: 'External', content: 'External data' },
      ];
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx, additionalSources);

      expect(result).toContain('## Additional Sources');
      expect(result).toContain('External');
      expect(result).toContain('External data');
    });

    it('includes output format preferences', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        output_format: {
          wants_table: true,
          wants_actionable_summary: true,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Output Format');
      expect(result).toContain('comparison tables');
      expect(result).toContain('actionable summary');
    });

    it('includes only table in output format', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        output_format: {
          wants_table: true,
          wants_actionable_summary: false,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Output Format');
      expect(result).toContain('comparison tables');
      expect(result).not.toContain('actionable summary');
    });

    it('includes only actionable summary in output format', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        output_format: {
          wants_table: false,
          wants_actionable_summary: true,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Output Format');
      expect(result).not.toContain('comparison tables');
      expect(result).toContain('actionable summary');
    });

    it('skips output format section when no format preferences', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        output_format: {
          wants_table: false,
          wants_actionable_summary: false,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).not.toContain('## Output Format');
    });

    it('includes high stakes without disclaimers in synthesis', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        safety: { high_stakes: true, required_disclaimers: [] },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('HIGH-STAKES');
      expect(result).not.toContain('Include these disclaimers');
    });

    it('skips conflicts section when no conflicts detected', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({ detected_conflicts: [] });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).not.toContain('## Detected Conflicts');
    });

    it('skips missing sections when none', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({ missing_sections: [] });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).not.toContain('## Missing Coverage');
    });

    it('skips red flags section when none', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({ red_flags: [] });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).not.toContain('## Concerns');
    });

    it('skips safety section when no safety concerns', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        safety: { high_stakes: false, required_disclaimers: [] },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).not.toContain('## Safety Considerations');
    });

    it('shows disclaimer without high stakes when disclaimers present', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        safety: { high_stakes: false, required_disclaimers: ['Disclaimer 1'] },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('## Safety Considerations');
      expect(result).toContain('Disclaimer 1');
      expect(result).not.toContain('HIGH-STAKES');
    });

    it('includes prefer_recent when time sensitive is false', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext({
        source_preference: {
          prefer_official_over_aggregators: false,
          prefer_recent_when_time_sensitive: false,
        },
      });
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('Weight all sources equally');
      expect(result).toContain('Consider all timeframes equally');
    });

    it('uses fallback label for additional sources without label', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext();
      const additionalSources: AdditionalSource[] = [{ content: 'Unlabeled content' }];
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx, additionalSources);

      expect(result).toContain('### U1 (Additional source; label: Source 1)');
      expect(result).toContain('Unlabeled content');
    });

    it('includes Source ID Map in contextual path', () => {
      const reports: SynthesisReport[] = [
        { model: 'GPT-4', content: 'Content 1' },
        { model: 'Claude', content: 'Content 2' },
      ];
      const ctx = createTestSynthesisContext();
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('SOURCE ID MAP (for Attribution)');
      expect(result).toContain('S1   | LLM  | GPT-4');
      expect(result).toContain('S2   | LLM  | Claude');
    });

    it('includes Attribution Rules in contextual path', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext();
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('ATTRIBUTION RULES (CRITICAL)');
      expect(result).toContain("DO NOT output a 'Source Utilization Breakdown' section");
    });

    it('includes attribution task in contextual Your Task list', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext();
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain(
        '6. **Attribute sources**: End each ## section with an Attribution line'
      );
    });

    it('uses S# format for LLM reports in contextual path', () => {
      const reports: SynthesisReport[] = [
        { model: 'GPT-4', content: 'Content 1' },
        { model: 'Claude', content: 'Content 2' },
      ];
      const ctx = createTestSynthesisContext();
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

      expect(result).toContain('### S1 (LLM report; model: GPT-4)');
      expect(result).toContain('### S2 (LLM report; model: Claude)');
    });

    it('uses U# format for additional sources in contextual path', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const ctx = createTestSynthesisContext();
      const additionalSources: AdditionalSource[] = [
        { label: 'Wikipedia', content: 'Wiki content' },
      ];
      const result = buildSynthesisPrompt(originalPrompt, reports, ctx, additionalSources);

      expect(result).toContain('### U1 (Additional source; label: Wikipedia)');
    });

    describe('filtering undefined values', () => {
      it('filters undefined reports from array', () => {
        const reports: (SynthesisReport | undefined)[] = [
          { model: 'GPT-4', content: 'Content 1' },
          undefined,
          { model: 'Claude', content: 'Content 2' },
          undefined,
        ];
        const result = buildSynthesisPrompt(originalPrompt, reports);

        expect(result).toContain('### S1 (LLM report; model: GPT-4)');
        expect(result).toContain('### S2 (LLM report; model: Claude)');
        expect(result).toContain('Content 1');
        expect(result).toContain('Content 2');
        // Should only have S1 and S2, not S3 or S4
        expect(result).not.toContain('### S3');
        expect(result).not.toContain('### S4');
      });

      it('filters undefined additional sources from array', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const additionalSources: (AdditionalSource | undefined)[] = [
          { label: 'Source 1', content: 'Content 1' },
          undefined,
          { label: 'Source 2', content: 'Content 2' },
        ];
        const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

        expect(result).toContain('### U1 (Additional source; label: Source 1)');
        expect(result).toContain('### U2 (Additional source; label: Source 2)');
        expect(result).not.toContain('### U3');
      });

      it('filters undefined values in contextual path with additional sources', () => {
        const reports: (SynthesisReport | undefined)[] = [
          undefined,
          { model: 'GPT-4', content: 'Content' },
        ];
        const ctx = createTestSynthesisContext();
        const additionalSources: (AdditionalSource | undefined)[] = [
          { content: 'Additional 1' },
          undefined,
          { content: 'Additional 2' },
        ];
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx, additionalSources);

        expect(result).toContain('### S1 (LLM report; model: GPT-4)');
        expect(result).toContain('### U1 (Additional source; label: Source 1)');
        expect(result).toContain('### U2 (Additional source; label: Source 2)');
      });

      it('handles all undefined reports', () => {
        const reports: (SynthesisReport | undefined)[] = [undefined, undefined];
        const result = buildSynthesisPrompt(originalPrompt, reports);

        expect(result).toContain('## Original Prompt');
        expect(result).toContain('## LLM Reports');
        expect(result).not.toContain('### S1');
      });

      it('handles all undefined additional sources', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const additionalSources: (AdditionalSource | undefined)[] = [undefined, undefined];
        const result = buildSynthesisPrompt(originalPrompt, reports, additionalSources);

        expect(result).not.toContain('## Additional Sources');
        expect(result).not.toContain('### U1');
      });
    });

    describe('all synthesis goals', () => {
      it('includes DEDUPE goal', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          synthesis_goals: ['dedupe'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Synthesis Goals');
        expect(result).toContain('DEDUPE');
        expect(result).toContain('Remove duplicate information, keeping the most complete version');
      });

      it('includes RANK_RECOMMENDATIONS goal', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          synthesis_goals: ['rank_recommendations'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Synthesis Goals');
        expect(result).toContain('RANK RECOMMENDATIONS');
        expect(result).toContain(
          'Order recommendations by quality, relevance, and source authority'
        );
      });

      it('includes SUMMARIZE goal', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          synthesis_goals: ['summarize'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Synthesis Goals');
        expect(result).toContain('SUMMARIZE');
        expect(result).toContain('Condense the information into key actionable points');
      });

      it('includes CONFLICT_AUDIT goal', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          synthesis_goals: ['conflict_audit'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Synthesis Goals');
        expect(result).toContain('CONFLICT AUDIT');
        expect(result).toContain(
          'Identify and explicitly analyze conflicting information between sources'
        );
      });

      it('includes multiple goals together', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          synthesis_goals: [
            'merge',
            'dedupe',
            'conflict_audit',
            'rank_recommendations',
            'summarize',
          ],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('MERGE');
        expect(result).toContain('DEDUPE');
        expect(result).toContain('CONFLICT AUDIT');
        expect(result).toContain('RANK RECOMMENDATIONS');
        expect(result).toContain('SUMMARIZE');
      });
    });

    describe('combinations and edge cases', () => {
      it('includes both high stakes warning and disclaimers', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          safety: {
            high_stakes: true,
            required_disclaimers: ['Consult a professional', 'Verify independently'],
          },
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Safety Considerations');
        expect(result).toContain('⚠️ This is a HIGH-STAKES topic');
        expect(result).toContain('Include these disclaimers');
        expect(result).toContain('- Consult a professional');
        expect(result).toContain('- Verify independently');
      });

      it('handles multiple conflicts', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          detected_conflicts: [
            {
              topic: 'Pricing',
              sources_involved: ['S1', 'S2'],
              conflict_summary: 'Different prices',
              severity: 'low',
            },
            {
              topic: 'Dates',
              sources_involved: ['S1', 'S2'],
              conflict_summary: 'Different dates',
              severity: 'medium',
            },
          ],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Detected Conflicts to Address');
        expect(result).toContain('Pricing');
        expect(result).toContain('Dates');
        expect(result).toContain('LOW');
        expect(result).toContain('MEDIUM');
      });

      it('handles multiple missing sections', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          missing_sections: ['Section A', 'Section B', 'Section C'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Missing Coverage');
        expect(result).toContain('- Section A');
        expect(result).toContain('- Section B');
        expect(result).toContain('- Section C');
      });

      it('handles multiple red flags', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const ctx = createTestSynthesisContext({
          red_flags: ['Flag 1', 'Flag 2', 'Flag 3'],
        });
        const result = buildSynthesisPrompt(originalPrompt, reports, ctx);

        expect(result).toContain('## Concerns to Address');
        expect(result).toContain('- Flag 1');
        expect(result).toContain('- Flag 2');
        expect(result).toContain('- Flag 3');
      });
    });

    describe('deprecated ExternalReport type alias', () => {
      it('accepts ExternalReport type alias for additional sources', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        // Using the deprecated ExternalReport alias
        const externalSources: ExternalReport[] = [
          { label: 'External', content: 'External content' },
        ];
        const result = buildSynthesisPrompt(originalPrompt, reports, externalSources);

        expect(result).toContain('## Additional Sources');
        expect(result).toContain('External content');
      });
    });

    describe('legacy path compatibility', () => {
      it('uses same language format in legacy path', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const result = buildSynthesisPrompt(originalPrompt, reports);

        expect(result).toContain('## Language Requirement');
        expect(result).toContain('SAME LANGUAGE as the Original Prompt');
      });

      it('includes attribution rules in legacy path', () => {
        const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
        const result = buildSynthesisPrompt(originalPrompt, reports);

        expect(result).toContain('ATTRIBUTION RULES (CRITICAL)');
        expect(result).toContain("DO NOT output a 'Source Utilization Breakdown' section");
      });
    });
  });
});
