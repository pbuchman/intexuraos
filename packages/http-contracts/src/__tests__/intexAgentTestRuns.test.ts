/* eslint-disable @typescript-eslint/explicit-function-return-type -- Contract fixtures preserve inferred literal types. */
import { describe, expect, it } from 'vitest';

import {
  classifyIntexAgentReplyDatePresentation,
  INTEX_AGENT_TEST_RUN_SCENARIO_COUNT,
  publicTestRunHeaderV1Schema,
  safeAgentUsageV1Schema,
  safeDeterministicCheckV1Schema,
  safeExpectedToolFactV1Schema,
  safeReplyEvaluationV1Schema,
  sanitizeIntexAgentReplyText,
  safeToolEvidenceV1Schema,
  testArtifactDeliveryV1Schema,
  testRunDtoV1Schema,
  testScenarioDtoV1Schema,
} from '../index.js';

const now = '2026-07-20T10:00:00.000Z';

describe('sanitizeIntexAgentReplyText', () => {
  it('redacts structured confirmation fields, continuations, URLs, and synthetic markers', () => {
    expect(
      sanitizeIntexAgentReplyText(
        'Add this event?\nTitle: Private INTEX-EVAL-002-F01\ncontinued detail\nStart: 2026-08-18\nURL: https://private.example/path'
      )
    ).toBe('Add this event?\nTitle: [redacted]\n\nStart: [redacted]\nURL: [redacted]');
  });

  it('redacts preference blocks and resumes ordinary text after a blank line', () => {
    expect(
      sanitizeIntexAgentReplyText(
        'User Preferences\n- private first\n2) private second\n\nOrdinary [synthetic-marker] text INTEX-EVAL-017.'
      )
    ).toBe(
      'User Preferences: [redacted]\n[redacted-preference-item]\n[redacted-preference-item]\n\nOrdinary [synthetic-marker] text [synthetic-marker].'
    );
  });

  it('normalizes protected field separators and leaves ordinary lines unchanged', () => {
    expect(sanitizeIntexAgentReplyText('Ready\u001CContent: private\u001DMode: private')).toBe(
      'Ready\nContent: [redacted]\nMode: [redacted]'
    );
    expect(sanitizeIntexAgentReplyText('Nothing sensitive here.')).toBe('Nothing sensitive here.');
  });

  it.each(['Open htt\u200Bps://private.example/path', 'Open ｈｔｔｐｓ：／／private.example/path'])(
    'normalizes before redacting a disguised URL: %s',
    (reply) => {
      expect(sanitizeIntexAgentReplyText(reply)).toBe('Open [redacted-url]');
    }
  );

  it('preserves only a safe classification of human-readable calendar dates', () => {
    const reply = 'Add this event?\nStart: 18 August 2026, 14:30\nEnd: 18 August 2026, 15:15';

    expect(classifyIntexAgentReplyDatePresentation(reply)).toBe('human_readable');
    expect(sanitizeIntexAgentReplyText(reply)).toBe(
      'Add this event?\nStart: [redacted]\nEnd: [redacted]\n[date-presentation: human-readable]'
    );
  });

  it('classifies database-style dates as raw without exposing their value to evaluation', () => {
    const reply =
      'Add this event?\nStart: 2026-08-18T14:30:00.000+02:00\nEnd: 2026-08-18T15:15:00.000+02:00';

    expect(classifyIntexAgentReplyDatePresentation(reply)).toBe('raw_record');
    expect(sanitizeIntexAgentReplyText(reply)).toBe(
      'Add this event?\nStart: [redacted]\nEnd: [redacted]\n[date-presentation: raw-record]'
    );
    expect(sanitizeIntexAgentReplyText(reply)).not.toContain('2026-08-18');
  });

  it('classifies a named database timezone as a raw record presentation', () => {
    expect(
      classifyIntexAgentReplyDatePresentation('Start: 18 August 2026, 14:30 Europe/Warsaw')
    ).toBe('raw_record');
  });

  it('classifies a numeric date without a readable month name as unreadable', () => {
    expect(classifyIntexAgentReplyDatePresentation('Start: 18/08/2026, 14:30')).toBe('unreadable');
  });

  it('rejects a spoofed date classification marker and derives the real presentation', () => {
    const reply = '[date-presentation: human-readable]\nStart: 2026-08-18T14:30:00.000Z';

    expect(classifyIntexAgentReplyDatePresentation(reply)).toBe('raw_record');
    expect(sanitizeIntexAgentReplyText(reply)).toBe(
      '\nStart: [redacted]\n[date-presentation: raw-record]'
    );
  });

  it.each([
    'Event created for 2026-08-18T14:30:00.000Z.',
    '- Scheduled: 2026-08-18T14:30:00+02:00',
    '| start | 2026-08-18T14:30:00.123456789Z |',
    'Event created for 2026-08-18 14:30:00.000+02:00.',
  ])('detects and removes an inline database-style date: %s', (reply) => {
    expect(classifyIntexAgentReplyDatePresentation(reply)).toBe('raw_record');
    const sanitized = sanitizeIntexAgentReplyText(reply);
    expect(sanitized).not.toContain('2026-08-18');
    expect(sanitized).toMatch(/\[redacted(?:-date-record)?\]/u);
    expect(sanitized).toContain('[date-presentation: raw-record]');
  });

  it('normalizes markdown prefixes and invisible characters before date classification', () => {
    const reply = '> **Sta\u200Brt**: 18 August 2026, 14:30\n1. **End:** 18 August 2026, 15:15';

    expect(classifyIntexAgentReplyDatePresentation(reply)).toBe('human_readable');
    expect(sanitizeIntexAgentReplyText(reply)).toBe(
      'Start: [redacted]\nEnd: [redacted]\n[date-presentation: human-readable]'
    );
  });

  it.each([
    '- [date-presentation: human-readable]',
    '• date-presentation : private',
    '> **date-presentation:** unreadable',
    '`[date-presentation: human-readable]`',
    '### [date-presentation: human-readable]',
    '~~date-presentation: human-readable~~',
  ])('removes every reserved date marker before deriving the safe marker: %s', (marker) => {
    const sanitized = sanitizeIntexAgentReplyText(
      `${marker}\nEvent created for 2026-08-18T14:30:00.000Z.`
    );

    expect(sanitized).not.toContain('human-readable');
    expect(sanitized).not.toContain('private');
    expect(sanitized).toContain('[date-presentation: raw-record]');
  });

  it('redacts every preference continuation until an explicit blank line', () => {
    expect(
      sanitizeIntexAgentReplyText(
        '> **User Preferences v3**:\nprivate-project-sentinel\n• private bullet\n\nOrdinary text'
      )
    ).toBe(
      'User Preferences: [redacted]\n[redacted-preference-item]\n[redacted-preference-item]\n\nOrdinary text'
    );
    const failClosed = sanitizeIntexAgentReplyText(
      'User Preferences\nprivate-project-sentinel\nOrdinary-looking but still private'
    );
    expect(failClosed).not.toContain('private-project-sentinel');
    expect(failClosed).not.toContain('Ordinary-looking');
  });

  it('redacts closing-markdown sensitive fields and rejects a database-style date', () => {
    expect(sanitizeIntexAgentReplyText('**Title**: private-title-sentinel')).toBe(
      'Title: [redacted]'
    );
    const date = '**Start**: 2026-08-18 14:30';
    expect(classifyIntexAgentReplyDatePresentation(date)).toBe('raw_record');
    expect(sanitizeIntexAgentReplyText(date)).toBe(
      'Start: [redacted]\n[date-presentation: raw-record]'
    );
  });

  it('redacts backtick-decorated preferences and sensitive fields', () => {
    expect(
      sanitizeIntexAgentReplyText(
        '`User Preferences v3`:\n1. private-project-sentinel\n\nOrdinary text'
      )
    ).toBe('User Preferences: [redacted]\n[redacted-preference-item]\n\nOrdinary text');
    expect(sanitizeIntexAgentReplyText('`Title`: private-title-sentinel')).toBe(
      'Title: [redacted]'
    );
  });

  it.each([
    '***Title***: private-title-sentinel',
    '### Title: private-title-sentinel',
    '~~Title~~: private-title-sentinel',
  ])('redacts sensitive labels independently of Markdown decoration: %s', (line) => {
    expect(sanitizeIntexAgentReplyText(line)).toBe('Title: [redacted]');
  });

  it('redacts preference headers independently of Markdown decoration', () => {
    expect(
      sanitizeIntexAgentReplyText('***User Preferences v3***:\nprivate-project-sentinel')
    ).toBe('User Preferences: [redacted]\n[redacted-preference-item]');
  });

  it.each(['| Title | private-title-sentinel |', '| Content | private-content-sentinel |'])(
    'redacts sensitive Markdown table rows: %s',
    (line) => {
      const sanitized = sanitizeIntexAgentReplyText(line);
      expect(sanitized).not.toContain('private-');
      expect(sanitized).toContain('[redacted]');
    }
  );

  it.each([
    'Add this event? Title: private-title-sentinel',
    'Create note? Content: private-content-sentinel',
    '<strong>Title</strong>: private-html-sentinel',
    '<table><tr><td>Title</td><td>private-html-table-sentinel</td></tr></table>',
    '<dl><dt>Title</dt><dd>private-html-description-sentinel</dd></dl>',
  ])('redacts sensitive fields embedded in prose or HTML: %s', (line) => {
    const sanitized = sanitizeIntexAgentReplyText(line);
    expect(sanitized).not.toContain('private-');
    expect(sanitized).toContain('[redacted]');
  });

  it('redacts an inline preference block heading and its continuation', () => {
    expect(
      sanitizeIntexAgentReplyText(
        'Here are User Preferences v3: private-project-sentinel\nprivate-continuation'
      )
    ).toBe('User Preferences: [redacted]\n[redacted-preference-item]');
  });

  it.each([
    '<dl><dt>User Preferences</dt><dd>private-project-sentinel</dd></dl>',
    '<table><tr><td>User Preferences</td><td>private-table-sentinel</td></tr></table>',
    '<p>User Preferences</p><p>private-paragraph-sentinel</p>',
  ])('redacts preference blocks expressed through structural HTML: %s', (reply) => {
    const sanitized = sanitizeIntexAgentReplyText(reply);

    expect(sanitized).toContain('User Preferences: [redacted]');
    expect(sanitized).not.toContain('private-');
  });

  it.each([
    ['Ti<strong>tle</strong>: private-split-title', 'private-split-title'],
    ['User <em>Preferences</em>: private-split-pref', 'private-split-pref'],
    ['INTEX-<span>EVAL-001</span> private-marker', 'INTEX-EVAL-001'],
    ['Open htt<strong>ps</strong>://private.example/path', 'private.example'],
    ['Open https:<span>//private.example/path</span>', 'private.example'],
    ['Event 2026-08-<em>18</em>T14:30:00.000Z', '2026-08-18'],
    ['Ti<!--x-->tle: private-comment-title', 'private-comment-title'],
    ['User <!--x-->Preferences: private-comment-pref', 'private-comment-pref'],
    ['Open htt<!--x-->ps://private-comment.example/path', 'private-comment.example'],
    ['INTEX-<!--x-->EVAL-001 private-comment-marker', 'INTEX-EVAL-001'],
    ['Ti&#116;le: private-entity-sentinel', 'private-entity-sentinel'],
    ['Title&#58; private-colon-sentinel', 'private-colon-sentinel'],
    ['Ti&amp;#116;le: private-nested-entity-sentinel', 'private-nested-entity-sentinel'],
    ['Ti<span\nclass=x>tle: private-newline-tag-sentinel', 'private-newline-tag-sentinel'],
    [
      `Ti<span data-padding="${'x'.repeat(300)}">tle: private-long-tag-sentinel`,
      'private-long-tag-sentinel',
    ],
    ['Ti&#x200B;tle: private-encoded-ignorable-title', 'private-encoded-ignorable-title'],
    ['htt&#x200B;ps://private-encoded-ignorable.example/path', 'private-encoded-ignorable.example'],
    ['INTEX-&#x200B;EVAL-001 private-encoded-marker', 'INTEX-EVAL-001'],
    ['&#xff34;itle: private-encoded-fullwidth-title', 'private-encoded-fullwidth-title'],
    [
      '&#xff48;&#xff54;&#xff54;&#xff50;&#xff53;://private-fullwidth.example/path',
      'private-fullwidth.example',
    ],
  ])('redacts protected content even when inline HTML splits its token: %s', (reply, secret) => {
    expect(sanitizeIntexAgentReplyText(reply)).not.toContain(secret);
  });

  it('removes a structural HTML date marker and derives the real presentation', () => {
    const sanitized = sanitizeIntexAgentReplyText(
      '<table><tr><td>date-presentation</td><td>human-readable</td></tr></table>\nEvent 2026-08-18T14:30:00.000Z'
    );

    expect(sanitized).not.toContain('human-readable');
    expect(sanitized).toContain('[date-presentation: raw-record]');
  });

  it('drops script and style content while preserving structural whitespace boundaries', () => {
    const sanitized = sanitizeIntexAgentReplyText(
      '<p>Visible first line</p>   <script>private-script-sentinel</script><style>private-style-sentinel</style><p>Visible second line</p>'
    );

    expect(sanitized).toContain('Visible first line');
    expect(sanitized).toContain('Visible second line');
    expect(sanitized).not.toContain('private-script-sentinel');
    expect(sanitized).not.toContain('private-style-sentinel');
  });

  it.each(['1c', '1d', '1e', '1f'])(
    'fails closed when an HTML entity decodes to protected control separator 0x%s',
    (hex) => {
      const sanitized = sanitizeIntexAgentReplyText(
        `Ti&#x${hex};tle: private-encoded-control-${hex}`
      );

      expect(sanitized).not.toContain(`private-encoded-control-${hex}`);
    }
  );

  it.each(['&#xE000;', '&#57344;'])(
    'fails closed when an HTML entity injects the internal boundary value: %s',
    (entity) => {
      const sanitized = sanitizeIntexAgentReplyText(
        `User Preferences${entity} ${entity}private-pua-preference-sentinel`
      );

      expect(sanitized).not.toContain('private-pua-preference-sentinel');
    }
  );

  it('classifies and redacts a backtick-decorated unreadable date', () => {
    const date = '`Start`: 2026-08-18 14:30';

    expect(classifyIntexAgentReplyDatePresentation(date)).toBe('raw_record');
    expect(sanitizeIntexAgentReplyText(date)).toBe(
      'Start: [redacted]\n[date-presentation: raw-record]'
    );
  });
});

function totals() {
  return {
    scenarios: {
      planned: 20,
      started: 1,
      running: 1,
      completed: 0,
      passed: 0,
      failed: 0,
      notRun: 19,
    },
    turns: { planned: 20, completed: 1 },
    replies: { expected: 20, observed: 1, judged: 1 },
    tools: { selected: 1, mockCompleted: 1, mockFailed: 0, unexpectedKnown: 0 },
    evaluations: {
      deterministicPassed: 1,
      deterministicFailed: 0,
      minimaxPassed: 1,
      minimaxFailed: 0,
      pending: 19,
    },
  };
}

function scenarioSummary(scenarioNumber = 1) {
  return {
    scenarioId: `scenario_${String(scenarioNumber).padStart(3, '0')}`,
    scenarioNumber,
    scenarioLabel: `Natural catalog label ${String(scenarioNumber)}`,
    scenarioRevision: 1,
    lifecycle: scenarioNumber === 1 ? ('running' as const) : ('not_run' as const),
    verdict: 'pending' as const,
    plannedTurns: 1,
    completedTurns: scenarioNumber === 1 ? 1 : 0,
    expectedReplies: 1,
    completedReplies: scenarioNumber === 1 ? 1 : 0,
    selectedTools: scenarioNumber === 1 ? (['create_note'] as const) : [],
    deterministicVerdict: 'pending' as const,
    semanticVerdict: 'pending' as const,
    startedAt: scenarioNumber === 1 ? now : null,
    finishedAt: null,
    durationMs: null,
  };
}

function header() {
  return {
    schemaVersion: 1 as const,
    runId: 'run_1',
    revision: 2,
    corpusId: 'intex-agent-matrix-corpus',
    corpusVersion: '2026-07-19',
    transport: 'matrix_whatsapp' as const,
    executionMode: 'strict_mock_tools' as const,
    lifecycle: 'running' as const,
    verdict: 'pending' as const,
    artifactDelivery: { status: 'pending' as const, failureCode: null, updatedAt: now },
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    currentScenarioNumber: 1,
    totals: totals(),
    cost: { agentNanoUsd: 123, evaluatorNanoUsd: 45, totalNanoUsd: 168 },
  };
}

describe('Intex Agent Test Runs public contracts', () => {
  it('keeps the corpus and evidence bounds explicit', () => {
    expect(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT).toBe(20);
    expect(
      testRunDtoV1Schema.parse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => scenarioSummary(index + 1)),
      }).scenarios
    ).toHaveLength(20);

    const toolEvidence = {
      event: 'selected' as const,
      toolName: 'create_note' as const,
      turnIndex: 19,
      ordinal: 20,
      facts: [],
    };
    expect(safeToolEvidenceV1Schema.safeParse(toolEvidence).success).toBe(true);
    expect(safeToolEvidenceV1Schema.safeParse({ ...toolEvidence, turnIndex: 20 }).success).toBe(
      false
    );
    expect(safeToolEvidenceV1Schema.safeParse({ ...toolEvidence, ordinal: 21 }).success).toBe(
      false
    );

    const check = {
      code: 'tool_name' as const,
      status: 'passed' as const,
      turnIndex: 19,
      replyIndex: 1,
      evidence: {
        expectedToolName: 'create_note' as const,
        actualToolName: 'create_note' as const,
        expectedTurnIndex: null,
        actualTurnIndex: null,
        expectedCount: null,
        actualCount: null,
        expectedTransition: null,
        actualTransition: null,
        expectedFacts: [],
        actualFacts: [],
      },
    };
    expect(safeDeterministicCheckV1Schema.safeParse(check).success).toBe(true);
    expect(
      ['user_message_count', 'agent_usage_count'].every(
        (code) => safeDeterministicCheckV1Schema.safeParse({ ...check, code }).success
      )
    ).toBe(true);
    expect(safeDeterministicCheckV1Schema.safeParse({ ...check, turnIndex: 20 }).success).toBe(
      false
    );
    expect(
      safeDeterministicCheckV1Schema.safeParse({
        ...check,
        evidence: { ...check.evidence, privateArgument: 'do not expose' },
      }).success
    ).toBe(false);

    const evaluation = {
      turnIndex: 19,
      replyIndex: 1,
      verdict: 'passed' as const,
      score: 5 as const,
      criteria: {
        understoodIntent: true,
        helpful: true,
        conciseAndClear: true,
        professionalTone: true,
        noPassiveAggression: true,
      },
      failureCodes: [],
      latencyMs: 1,
      usage: {
        logicalCalls: 1 as const,
        repairCount: 0 as const,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    };
    expect(safeReplyEvaluationV1Schema.safeParse(evaluation).success).toBe(true);
    expect(safeReplyEvaluationV1Schema.safeParse({ ...evaluation, turnIndex: 20 }).success).toBe(
      false
    );

    const usage = {
      turnIndex: 19,
      stage: 'agent_generation' as const,
      callOrdinal: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costNanoUsd: 1,
    };
    expect(safeAgentUsageV1Schema.safeParse(usage).success).toBe(true);
    expect(safeAgentUsageV1Schema.safeParse({ ...usage, turnIndex: 20 }).success).toBe(false);
  });

  it('requires scenarios to stay ordered and uniquely identified', () => {
    const scenarios = Array.from({ length: 20 }, (_, index) => scenarioSummary(index + 1));
    const outOfOrder = scenarios.map((scenario, index) =>
      index === 0
        ? { ...scenario, scenarioNumber: 2 }
        : index === 1
          ? { ...scenario, scenarioNumber: 1 }
          : scenario
    );
    expect(testRunDtoV1Schema.safeParse({ run: header(), scenarios: outOfOrder }).success).toBe(
      false
    );

    const duplicateId = scenarios.map((scenario, index) =>
      index === 1 ? { ...scenario, scenarioId: scenarios[0]?.scenarioId } : scenario
    );
    expect(testRunDtoV1Schema.safeParse({ run: header(), scenarios: duplicateId }).success).toBe(
      false
    );
  });

  it('requires values only for equality tool-fact expectations', () => {
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'equals',
        value: 12,
      }).success
    ).toBe(true);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'equals',
        value: null,
      }).success
    ).toBe(false);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'exists',
        value: null,
      }).success
    ).toBe(true);
    expect(
      safeExpectedToolFactV1Schema.safeParse({
        name: 'contentLength',
        operator: 'absent',
        value: 12,
      }).success
    ).toBe(false);
  });

  it('accepts only the closed artifact-delivery states', () => {
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'ready',
        failureCode: null,
        updatedAt: now,
      }).success
    ).toBe(true);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'failed',
        failureCode: 'REPORT_PUBLICATION_FAILED',
        updatedAt: now,
      }).success
    ).toBe(true);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'pending',
        failureCode: 'REPORT_STAGING_FAILED',
        updatedAt: now,
      }).success
    ).toBe(false);
    expect(
      testArtifactDeliveryV1Schema.safeParse({
        status: 'failed',
        failureCode: 'RAW_PROVIDER_ERROR',
        updatedAt: now,
      }).success
    ).toBe(false);
  });

  it('rejects private and unknown fields recursively', () => {
    expect(
      publicTestRunHeaderV1Schema.safeParse({ ...header(), userId: 'private-user' }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => ({
          ...scenarioSummary(index + 1),
          sessionId: 'private-session',
        })),
      }).success
    ).toBe(false);
  });

  it('accepts the closed safe timeline and rejects raw payloads or judge rationale', () => {
    const dto = {
      schemaVersion: 1 as const,
      runId: 'run_1',
      runRevision: 2,
      agentModel: 'or:deepseek/deepseek-v4-flash' as const,
      evaluatorModel: 'or:minimax/minimax-m3' as const,
      scenario: scenarioSummary(),
      eventWatermark: 3,
      timeline: [
        {
          type: 'session_started' as const,
          timelineIndex: 0,
          eventSequence: 1,
          turnIndex: 0,
          startReason: 'user_requested_new_session' as const,
          explicit: true,
          createdAt: now,
        },
        {
          type: 'user_message' as const,
          timelineIndex: 1,
          eventSequence: 2,
          turnIndex: 1,
          text: 'Natural message',
          createdAt: now,
        },
        {
          type: 'tool_selected' as const,
          timelineIndex: 2,
          eventSequence: 3,
          turnIndex: 1,
          ordinal: 1,
          toolName: 'create_note' as const,
          facts: [{ name: 'contentLength' as const, value: 12 }],
          createdAt: now,
        },
        {
          type: 'minimax_evaluation' as const,
          timelineIndex: 3,
          evaluatorModel: 'or:minimax/minimax-m3' as const,
          evaluation: {
            turnIndex: 1,
            replyIndex: 1,
            verdict: 'passed' as const,
            score: 5 as const,
            criteria: {
              understoodIntent: true,
              helpful: true,
              conciseAndClear: true,
              professionalTone: true,
              noPassiveAggression: true,
            },
            failureCodes: [],
            latencyMs: 15,
            usage: {
              logicalCalls: 1 as const,
              repairCount: 0 as const,
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              costNanoUsd: 2,
            },
          },
        },
      ],
    };
    expect(testScenarioDtoV1Schema.safeParse(dto).success).toBe(true);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [{ ...dto.timeline[0], payload: { capability: 'secret' } }],
      }).success
    ).toBe(false);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [{ ...dto.timeline[2], rationale: 'private model reasoning' }],
      }).success
    ).toBe(false);

    const replyEvaluation = dto.timeline[3];
    if (replyEvaluation === undefined) throw new Error('Test fixture is missing reply evaluation');
    const sixthReplyEvaluation = {
      ...replyEvaluation,
      evaluation: { ...replyEvaluation.evaluation, replyIndex: 6 },
    };
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [sixthReplyEvaluation],
      }).success
    ).toBe(false);
    expect(
      testScenarioDtoV1Schema.safeParse({
        ...dto,
        timeline: [
          {
            type: 'assistant_message',
            timelineIndex: 0,
            eventSequence: 1,
            turnIndex: 1,
            replyIndex: 6,
            text: 'Sixth reply',
            createdAt: now,
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects unsafe counters, duplicate tools, inconsistent cost, and non-contiguous timeline indexes', () => {
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        totals: { ...totals(), turns: { planned: Number.MAX_SAFE_INTEGER + 1, completed: 1 } },
      }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) =>
          index === 0
            ? { ...scenarioSummary(1), selectedTools: ['create_note', 'create_note'] }
            : scenarioSummary(index + 1)
        ),
      }).success
    ).toBe(false);
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        cost: { agentNanoUsd: 1, evaluatorNanoUsd: 2, totalNanoUsd: 4 },
      }).success
    ).toBe(false);
    expect(
      publicTestRunHeaderV1Schema.safeParse({
        ...header(),
        cost: { agentNanoUsd: null, evaluatorNanoUsd: 2, totalNanoUsd: 2 },
      }).success
    ).toBe(false);
    expect(
      testRunDtoV1Schema.safeParse({
        run: header(),
        scenarios: Array.from({ length: 20 }, (_, index) => ({
          ...scenarioSummary(index + 1),
          ...(index === 1 ? { scenarioId: scenarioSummary(1).scenarioId } : {}),
        })),
      }).success
    ).toBe(false);
  });

  it('requires MiniMax verdict, criteria, and failure codes to describe one result', () => {
    const passed = {
      turnIndex: 0,
      replyIndex: 1,
      verdict: 'passed' as const,
      score: 5 as const,
      criteria: {
        understoodIntent: true,
        helpful: true,
        conciseAndClear: true,
        professionalTone: true,
        noPassiveAggression: true,
      },
      failureCodes: [],
      latencyMs: 1,
      usage: {
        logicalCalls: 1 as const,
        repairCount: 0 as const,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    };
    const failed = {
      ...passed,
      verdict: 'failed' as const,
      score: 1 as const,
      criteria: { ...passed.criteria, helpful: false },
      failureCodes: ['helpful' as const],
    };

    expect(safeReplyEvaluationV1Schema.safeParse(passed).success).toBe(true);
    expect(safeReplyEvaluationV1Schema.safeParse(failed).success).toBe(true);
    expect(
      safeReplyEvaluationV1Schema.safeParse({
        ...passed,
        criteria: { ...passed.criteria, helpful: false },
        failureCodes: ['helpful'],
      }).success
    ).toBe(false);
    expect(safeReplyEvaluationV1Schema.safeParse({ ...failed, failureCodes: [] }).success).toBe(
      false
    );
    expect(
      safeReplyEvaluationV1Schema.safeParse({
        ...failed,
        criteria: passed.criteria,
        failureCodes: [],
      }).success
    ).toBe(false);
  });
});
