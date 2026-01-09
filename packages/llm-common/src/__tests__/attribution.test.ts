import { describe, expect, it } from 'vitest';
import {
  parseAttributionLine,
  parseSections,
  buildSourceMap,
  validateSynthesisAttributions,
  generateBreakdown,
  stripAttributionLines,
  type SourceId,
  type ParsedSection,
  type SourceMapItem,
} from '../attribution.js';

describe('parseAttributionLine', () => {
  it('parses valid attribution line', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false'
    );
    expect(result).toEqual({
      primary: ['S1', 'S2'],
      secondary: ['U1'],
      constraints: [],
      unk: false,
    });
  });

  it('handles multi-digit IDs', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S10,S123; Secondary=U12; Constraints=U99; UNK=false'
    );
    expect(result).toEqual({
      primary: ['S10', 'S123'],
      secondary: ['U12'],
      constraints: ['U99'],
      unk: false,
    });
  });

  it('handles whitespace variations', () => {
    const result = parseAttributionLine(
      'Attribution: Primary = S1 , S2 ; Secondary = U1 ; Constraints = ; UNK = false'
    );
    expect(result).toEqual({
      primary: ['S1', 'S2'],
      secondary: ['U1'],
      constraints: [],
      unk: false,
    });
  });

  it('returns null for malformed line', () => {
    expect(parseAttributionLine('Not an attribution line')).toBe(null);
    expect(parseAttributionLine('Attribution: InvalidFormat')).toBe(null);
    expect(parseAttributionLine('Attribution: Primary')).toBe(null);
  });

  it('returns null for unknown ID format', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=X1; Secondary=U1; Constraints=; UNK=false'
    );
    expect(result).toBe(null);
  });

  it('handles empty constraints list', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1; Secondary=S2; Constraints=; UNK=false'
    );
    expect(result?.constraints).toEqual([]);
  });

  it('parses UNK=true', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1; Secondary=; Constraints=; UNK=true'
    );
    expect(result?.unk).toBe(true);
  });

  it('handles missing UNK key as false', () => {
    const result = parseAttributionLine('Attribution: Primary=S1; Secondary=; Constraints=');
    expect(result?.unk).toBe(false);
  });

  it('returns null for invalid UNK value', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1; Secondary=; Constraints=; UNK=maybe'
    );
    expect(result).toBe(null);
  });

  it('handles case-insensitive Attribution prefix', () => {
    const result = parseAttributionLine(
      'attribution: Primary=S1; Secondary=; Constraints=; UNK=false'
    );
    expect(result).not.toBe(null);
  });

  it('handles leading and trailing whitespace', () => {
    const result = parseAttributionLine(
      '  Attribution: Primary=S1; Secondary=; Constraints=; UNK=false  '
    );
    expect(result).not.toBe(null);
  });

  it('returns null when key is present but value is missing', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=; Secondary; Constraints=; UNK=false'
    );
    expect(result).toBe(null);
  });

  it('handles trailing semicolon gracefully', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1; Secondary=; Constraints=; UNK=false;'
    );
    expect(result).toEqual({
      primary: ['S1'],
      secondary: [],
      constraints: [],
      unk: false,
    });
  });

  it('handles empty string after Attribution:', () => {
    const result = parseAttributionLine('Attribution: ');
    expect(result?.unk).toBe(false);
    expect(result?.primary).toEqual([]);
  });
});

describe('parseSections', () => {
  it('parses ## headings as sections', () => {
    const markdown = `## Section 1
Content here
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

## Section 2
More content
Attribution: Primary=S2; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.title).toBe('Section 1');
    expect(sections[0]?.level).toBe(2);
    expect(sections[1]?.title).toBe('Section 2');
    expect(sections[1]?.level).toBe(2);
  });

  it('falls back to ### when no ## present', () => {
    const markdown = `### Section A
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

### Section B
Content
Attribution: Primary=S2; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.level).toBe(3);
    expect(sections[1]?.level).toBe(3);
  });

  it('creates implicit section when no headings', () => {
    const markdown = `Some content without headings
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Synthesis');
    expect(sections[0]?.level).toBe(2);
  });

  it('extracts attribution from section end', () => {
    const markdown = `## Overview
Content line 1
Content line 2
Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections[0]?.attribution).toEqual({
      primary: ['S1', 'S2'],
      secondary: ['U1'],
      constraints: [],
      unk: false,
    });
  });

  it('handles empty sections', () => {
    const markdown = `## Section 1

## Section 2
Content here`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.attribution).toBe(null);
  });

  it('handles section at document end', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

## Section 2
Final content
Attribution: Primary=S2; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[1]?.attribution).not.toBe(null);
  });

  it('ignores ### headings when ## headings exist', () => {
    const markdown = `## Main Section
Content
### Subsection
More content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Main Section');
  });

  it('handles document with only whitespace lines', () => {
    const markdown = `

## Section 1

Content

Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.attribution).not.toBe(null);
  });

  it('handles malformed headings gracefully', () => {
    const markdown = `##
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Synthesis');
  });

  it('handles h3 malformed headings gracefully', () => {
    const markdown = `###
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false`;

    const sections = parseSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Synthesis');
  });
});

describe('buildSourceMap', () => {
  it('maps reports to S1..Sn', () => {
    const reports = [{ model: 'GPT-4' }, { model: 'Claude' }];
    const sourceMap = buildSourceMap(reports);

    expect(sourceMap).toEqual([
      { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
      { id: 'S2', kind: 'llm', displayName: 'Claude' },
    ]);
  });

  it('maps additionalSources to U1..Um', () => {
    const reports = [{ model: 'GPT-4' }];
    const additionalSources = [{ label: 'Wikipedia' }, { label: 'Custom' }];
    const sourceMap = buildSourceMap(reports, additionalSources);

    expect(sourceMap).toEqual([
      { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
      { id: 'U1', kind: 'user', displayName: 'Wikipedia' },
      { id: 'U2', kind: 'user', displayName: 'Custom' },
    ]);
  });

  it('handles empty arrays', () => {
    const sourceMap = buildSourceMap([]);
    expect(sourceMap).toEqual([]);
  });

  it('handles undefined additionalSources', () => {
    const reports = [{ model: 'GPT-4' }];
    const sourceMap = buildSourceMap(reports);
    expect(sourceMap).toHaveLength(1);
  });

  it('uses Source N fallback for missing label', () => {
    const reports = [{ model: 'GPT-4' }];
    const additionalSources = [{ content: 'Some content' }, { label: 'Named' }];
    const sourceMap = buildSourceMap(reports, additionalSources);

    expect(sourceMap[1]?.displayName).toBe('Source 1');
    expect(sourceMap[2]?.displayName).toBe('Named');
  });

  it('handles sparse arrays with sequential IDs', () => {
    const reports = [{ model: 'GPT-4' }, undefined, { model: 'Claude' }];
    const sourceMap = buildSourceMap(reports);

    expect(sourceMap).toHaveLength(2);
    expect(sourceMap[0]?.id).toBe('S1');
    expect(sourceMap[1]?.id).toBe('S2');
  });

  it('handles sparse additionalSources with sequential IDs', () => {
    const reports = [{ model: 'GPT-4' }];
    const additionalSources = [{ label: 'Wikipedia' }, undefined, { label: 'Custom' }];
    const sourceMap = buildSourceMap(reports, additionalSources);

    expect(sourceMap).toHaveLength(3);
    expect(sourceMap[1]?.id).toBe('U1');
    expect(sourceMap[2]?.id).toBe('U2');
  });
});

describe('validateSynthesisAttributions', () => {
  const createSourceMap = (): SourceMapItem[] => [
    { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
    { id: 'S2', kind: 'llm', displayName: 'Claude' },
    { id: 'U1', kind: 'user', displayName: 'Wikipedia' },
  ];

  it('returns valid for correct attributions', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S1; Secondary=S2; Constraints=U1; UNK=false

## Section 2
Content
Attribution: Primary=S2; Secondary=U1; Constraints=; UNK=false`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns error for missing attribution', () => {
    const markdown = `## Section 1
Content without attribution

## Section 2
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Section "Section 1" is missing Attribution line');
  });

  it('returns error for malformed attribution', () => {
    const markdown = `## Section 1
Content
Attribution: InvalidFormat`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Section "Section 1" is missing Attribution line');
  });

  it('returns error for unknown source ID', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S99; Secondary=; Constraints=; UNK=false`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Section "Section 1" references unknown source ID: S99');
  });

  it('accepts UNK=true as valid', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=true`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(true);
  });

  it('validates all IDs including secondary and constraints', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S1; Secondary=U99; Constraints=S2; UNK=false`;

    const result = validateSynthesisAttributions(markdown, createSourceMap());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Section "Section 1" references unknown source ID: U99');
  });
});

describe('generateBreakdown', () => {
  const createTestSections = (): ParsedSection[] => [
    {
      title: 'Overview',
      level: 2,
      attribution: {
        primary: ['S1', 'S2'] as SourceId[],
        secondary: ['U1'] as SourceId[],
        constraints: [] as SourceId[],
        unk: false,
      },
      startLine: 0,
      endLine: 5,
    },
    {
      title: 'Details',
      level: 2,
      attribution: {
        primary: ['S1'] as SourceId[],
        secondary: ['S2'] as SourceId[],
        constraints: ['U1'] as SourceId[],
        unk: false,
      },
      startLine: 6,
      endLine: 10,
    },
  ];

  const createTestSourceMap = (): SourceMapItem[] => [
    { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
    { id: 'S2', kind: 'llm', displayName: 'Claude' },
    { id: 'U1', kind: 'user', displayName: 'Wikipedia' },
    { id: 'U2', kind: 'user', displayName: 'Unused' },
  ];

  it('generates scorecard table', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('### Scorecard');
    expect(breakdown).toContain('| ID | Name | Primary | Secondary | Constraints | Score |');
  });

  it('calculates score correctly (constraints excluded)', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('| S1 | GPT-4 | 2 | 0 | 0 | 6 |');
    expect(breakdown).toContain('| S2 | Claude | 1 | 1 | 0 | 4 |');
    expect(breakdown).toContain('| U1 | Wikipedia | 0 | 1 | 1 | 1 |');
  });

  it('generates per-source usage list', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('### Per-Source Usage');
    expect(breakdown).toContain('**S1** (GPT-4): Primary in: Overview, Details');
    expect(breakdown).toContain('**S2** (Claude): Primary in: Overview. Secondary in: Details');
    expect(breakdown).toContain(
      '**U1** (Wikipedia): Primary in: —. Secondary in: Overview. Constraints in: Details'
    );
  });

  it('identifies ignored sources', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('### Ignored Sources');
    expect(breakdown).toContain('**U2** (Unused)');
  });

  it('handles empty sections array', () => {
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown([], sourceMap);

    expect(breakdown).toContain('No sections found.');
  });

  it('sorts by score descending', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    const s1Index = breakdown.indexOf('S1 | GPT-4');
    const s2Index = breakdown.indexOf('S2 | Claude');
    const u1Index = breakdown.indexOf('U1 | Wikipedia');

    expect(s1Index).toBeLessThan(s2Index);
    expect(s2Index).toBeLessThan(u1Index);
  });

  it('handles all sources ignored', () => {
    const sections: ParsedSection[] = [
      {
        title: 'Test',
        level: 2,
        attribution: null,
        startLine: 0,
        endLine: 5,
      },
    ];
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('All sources were ignored.');
  });

  it('includes footer disclaimer', () => {
    const sections = createTestSections();
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain(
      '_Attribution data derived from parsed markers. No interpretation applied._'
    );
  });

  it('handles section with UNK=true', () => {
    const sections: ParsedSection[] = [
      {
        title: 'Uncertain',
        level: 2,
        attribution: {
          primary: ['S1'] as SourceId[],
          secondary: [] as SourceId[],
          constraints: [] as SourceId[],
          unk: true,
        },
        startLine: 0,
        endLine: 5,
      },
    ];
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('| S1 | GPT-4 | 1 | 0 | 0 | 3 |');
  });

  it('handles no ignored sources', () => {
    const sections: ParsedSection[] = [
      {
        title: 'Test',
        level: 2,
        attribution: {
          primary: ['S1'] as SourceId[],
          secondary: ['S2'] as SourceId[],
          constraints: [] as SourceId[],
          unk: false,
        },
        startLine: 0,
        endLine: 5,
      },
    ];
    const sourceMap: SourceMapItem[] = [
      { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
      { id: 'S2', kind: 'llm', displayName: 'Claude' },
    ];
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('### Ignored Sources');
    expect(breakdown).toContain('None.');
  });

  it('handles sections with unknown source IDs gracefully', () => {
    const sections: ParsedSection[] = [
      {
        title: 'Test',
        level: 2,
        attribution: {
          primary: ['S99'] as SourceId[],
          secondary: ['U99'] as SourceId[],
          constraints: ['S98'] as SourceId[],
          unk: false,
        },
        startLine: 0,
        endLine: 5,
      },
    ];
    const sourceMap: SourceMapItem[] = [{ id: 'S1', kind: 'llm', displayName: 'GPT-4' }];
    const breakdown = generateBreakdown(sections, sourceMap);

    // Unknown IDs are ignored, S1 has zero usage so it goes to Ignored Sources
    // When all sources are ignored, code outputs "All sources were ignored." without listing them
    expect(breakdown).toContain('All sources were ignored.');
    expect(breakdown).toContain('No sources were used.');
  });

  it('handles empty primary, secondary, and constraints lists', () => {
    const sections: ParsedSection[] = [
      {
        title: 'Empty Attribution',
        level: 2,
        attribution: {
          primary: [] as SourceId[],
          secondary: [] as SourceId[],
          constraints: [] as SourceId[],
          unk: false,
        },
        startLine: 0,
        endLine: 5,
      },
    ];
    const sourceMap = createTestSourceMap();
    const breakdown = generateBreakdown(sections, sourceMap);

    expect(breakdown).toContain('All sources were ignored.');
  });
});

describe('stripAttributionLines', () => {
  it('strips single attribution line', () => {
    const markdown = `## Section 1
Content here
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

More content`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`## Section 1
Content here

More content`);
  });

  it('strips multiple attribution lines', () => {
    const markdown = `## Section 1
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

## Section 2
More content
Attribution: Primary=S2; Secondary=; Constraints=; UNK=false`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`## Section 1
Content

## Section 2
More content`);
  });

  it('preserves Source Utilization Breakdown section', () => {
    const markdown = `## Overview
Content
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

## Source Utilization Breakdown (Generated)

### Scorecard
| ID | Name | Primary | Secondary | Constraints | Score |`;

    const result = stripAttributionLines(markdown);
    expect(result).toContain('## Source Utilization Breakdown (Generated)');
    expect(result).toContain('### Scorecard');
    expect(result).not.toContain('Attribution: Primary=S1');
  });

  it('handles case-insensitive matching', () => {
    const markdown = `Content
attribution: Primary=S1; Secondary=; Constraints=; UNK=false
ATTRIBUTION: Primary=S2; Secondary=; Constraints=; UNK=false
More content`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`Content
More content`);
  });

  it('preserves empty lines and other content', () => {
    const markdown = `## Section 1

Content line 1

Content line 2

Attribution: Primary=S1; Secondary=; Constraints=; UNK=false

## Section 2`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`## Section 1

Content line 1

Content line 2


## Section 2`);
  });

  it('handles markdown with no attribution lines', () => {
    const markdown = `## Section 1
Content here
More content`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(markdown);
  });

  it('handles empty string', () => {
    const result = stripAttributionLines('');
    expect(result).toBe('');
  });

  it('handles attribution line with leading whitespace', () => {
    const markdown = `Content
   Attribution: Primary=S1; Secondary=; Constraints=; UNK=false
More content`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`Content
More content`);
  });

  it('preserves lines that contain "attribution" but do not start with it', () => {
    const markdown = `This is about attribution systems
Content here
Attribution: Primary=S1; Secondary=; Constraints=; UNK=false
More discussion about attribution`;

    const result = stripAttributionLines(markdown);
    expect(result).toBe(`This is about attribution systems
Content here
More discussion about attribution`);
  });
});
