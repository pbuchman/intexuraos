import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseLedgerJsonl,
  runLedgerValidatorCli,
  validateEvidenceRows,
} from '../validate-dev-hibernation-ledger.mjs';
import * as ledgerValidatorModule from '../validate-dev-hibernation-ledger.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  'docs/operations/evidence/dev-hibernation-ledger.schema.json'
);
const RUN_ID = '20260828T002847Z-paddc4965d21e-b265702826912';
const ARTIFACT_CONTENT = Buffer.from('frozen ref matrix evidence\n');
const ARTIFACT_SHA256 = sha256(ARTIFACT_CONTENT);
const SCHEMA_SHA256 = sha256(readFileSync(SCHEMA_PATH));
const temporaryDirectories: string[] = [];

interface CliFixture {
  directory: string;
  evidenceRoot: string;
  ledgerPath: string;
}

interface CliReport {
  valid: boolean;
  rowCount: number;
  schemaSha256: string;
  runId: string;
  errors: string[];
}

interface LedgerValidationOptions {
  expectedRunId: string;
  evidenceRoot: string;
  sourceLines?: number[];
  artifactLoader?: (evidenceRoot: string, relativePath: string) => Uint8Array;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function loadSchema(): unknown {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as unknown;
}

function validationOptions(
  overrides: Partial<LedgerValidationOptions> = {}
): LedgerValidationOptions {
  return {
    expectedRunId: RUN_ID,
    evidenceRoot: '/evidence',
    artifactLoader: () => ARTIFACT_CONTENT,
    ...overrides,
  };
}

function validateRows(
  rows: unknown[],
  overrides: Partial<LedgerValidationOptions> = {}
): ReturnType<typeof validateEvidenceRows> {
  return validateEvidenceRows(rows, loadSchema(), validationOptions(overrides));
}

function validRow(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    milestone: 'M0',
    stepId: 'M0.1',
    observedAt: '2026-08-28T00:28:47Z',
    appendedAt: '2026-08-28T00:29:47Z',
    actorAlias: 'operator-primary',
    targetSystem: 'intexuraos-primary',
    sourceRevisions: [
      {
        repository: 'intexuraos',
        ref: 'refs/heads/codex/intexuraos-dev-hibernation',
        commitSha: '265702826912a54cdbb1d39122a8cb7deece9d8f',
        treeSha: '9c90e447dc1b6c49cecf8ce6fe8a4b24ac350b5f',
      },
    ],
    sourceRevisionsNotApplicableReason: null,
    externalObjectIds: [
      {
        provider: 'github',
        objectType: 'pull-request',
        idKind: 'provider-native',
        id: '2512',
      },
    ],
    externalObjectIdsNotApplicableReason: null,
    artifactRelativePath: 'm0-baseline/repositories.json',
    artifactSha256: ARTIFACT_SHA256,
    privacyClassification: 'private',
    result: 'PASS',
    conclusion: 'Frozen ref matrix matches the authoritative remotes.',
  };
}

function createCliFixture(rows: unknown[] = [validRow()]): CliFixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'dev-hibernation-ledger-test-'));
  temporaryDirectories.push(directory);
  const evidenceRoot = path.join(directory, 'evidence');
  const artifactPath = path.join(evidenceRoot, 'm0-baseline/repositories.json');
  const ledgerPath = path.join(directory, 'evidence-ledger.jsonl');
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, ARTIFACT_CONTENT, { mode: 0o600 });
  writeFileSync(ledgerPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, {
    mode: 0o600,
  });
  return { directory, evidenceRoot, ledgerPath };
}

function requiredCliArgs(
  fixture: CliFixture,
  overrides: Partial<Record<'schema' | 'schemaSha256' | 'runId' | 'evidenceRoot', string>> = {}
): string[] {
  return [
    '--ledger',
    fixture.ledgerPath,
    '--schema',
    overrides.schema ?? SCHEMA_PATH,
    '--expected-schema-sha256',
    overrides.schemaSha256 ?? SCHEMA_SHA256,
    '--expected-run-id',
    overrides.runId ?? RUN_ID,
    '--evidence-root',
    overrides.evidenceRoot ?? fixture.evidenceRoot,
  ];
}

function runCli(argv: string[]): { exitCode: number; report: CliReport } {
  const output: string[] = [];
  const exitCode = runLedgerValidatorCli(argv, (line) => output.push(line));
  return { exitCode, report: JSON.parse(output.join('')) as CliReport };
}

describe('dev hibernation evidence ledger validator', () => {
  it('pins the repository schema to the independent embedded v1 trust root', () => {
    const validatorWithTrustRoot = ledgerValidatorModule as typeof ledgerValidatorModule & {
      FROZEN_SCHEMA_V1_SHA256?: string;
    };

    expect(validatorWithTrustRoot.FROZEN_SCHEMA_V1_SHA256).toBe(SCHEMA_SHA256);
  });

  it('accepts a complete schema-valid row with its verified artifact', () => {
    expect(validateRows([validRow()])).toEqual({ valid: true, errors: [] });
  });

  it('rejects an empty ledger', () => {
    const result = validateRows([]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('at least one row');
  });

  it('requires one expected RUN_ID across every ledger row', () => {
    const differentRun = '20260828T002848Z-paddc4965d21e-b265702826912';
    const result = validateRows([validRow(), { ...validRow(), runId: differentRun }]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('runId');
  });

  it('requires monotonically non-decreasing appendedAt timestamps', () => {
    const result = validateRows([
      { ...validRow(), appendedAt: '2026-08-28T00:30:47Z' },
      { ...validRow(), stepId: 'M0.2', appendedAt: '2026-08-28T00:29:47Z' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('monotonic');
  });

  it('accepts empty identity arrays only with allow-listed reasons bound to targetSystem', () => {
    const row = validRow();
    row.sourceRevisions = [];
    row.sourceRevisionsNotApplicableReason =
      'reasonCode=external-provider-observation;target=intexuraos-primary';
    row.externalObjectIds = [];
    row.externalObjectIdsNotApplicableReason =
      'reasonCode=repository-observation;target=intexuraos-primary';

    expect(validateRows([row])).toEqual({ valid: true, errors: [] });

    row.externalObjectIdsNotApplicableReason = null;
    const invalid = validateRows([row]);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join('\n')).toContain('externalObjectIdsNotApplicableReason');
  });

  it.each([
    'not.applicable to this row',
    'N O T _ A P P L I C A B L E',
    'N / A for this row only',
    'T_B_D',
    'to-be-determined',
    'pending_investigation',
    'awaiting.investigation',
    'generic placeholder for later',
    'status UNKNOWN until later',
    'null-value pending review',
    'none yet',
    'todo after cutover',
    'no external object',
    'no external object yet',
  ])('rejects generic not-applicable reason %s', (reason) => {
    const row = validRow();
    row.externalObjectIds = [];
    row.externalObjectIdsNotApplicableReason = reason;

    const result = validateRows([row]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('allow-listed structured reason');
  });

  it('rejects structured reasons with the wrong array code, target, or syntax', () => {
    const wrongCode = validRow();
    wrongCode.sourceRevisions = [];
    wrongCode.sourceRevisionsNotApplicableReason =
      'reasonCode=repository-observation;target=intexuraos-primary';
    const wrongTarget = validRow();
    wrongTarget.externalObjectIds = [];
    wrongTarget.externalObjectIdsNotApplicableReason =
      'reasonCode=repository-observation;target=home-dev';
    const wrongSyntax = validRow();
    wrongSyntax.externalObjectIds = [];
    wrongSyntax.externalObjectIdsNotApplicableReason =
      'reasonCode=repository-observation; target=intexuraos-primary';

    expect(validateRows([wrongCode]).valid).toBe(false);
    expect(validateRows([wrongTarget]).valid).toBe(false);
    expect(validateRows([wrongSyntax]).valid).toBe(false);
  });

  it('requires null not-applicable reasons when identity arrays are populated', () => {
    const row = validRow();
    row.sourceRevisionsNotApplicableReason = 'repository revision was captured';
    row.externalObjectIdsNotApplicableReason = 'provider object was captured';

    const result = validateRows([row]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('sourceRevisionsNotApplicableReason');
    expect(result.errors.join('\n')).toContain('externalObjectIdsNotApplicableReason');
  });

  it.each([
    [
      'abbreviated commit SHA',
      { sourceRevisions: [{ ...validRow().sourceRevisions?.[0], commitSha: '2657028' }] },
    ],
    [
      'null external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: null }] },
    ],
    [
      'placeholder external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'TBD' }] },
    ],
    [
      'underscored placeholder external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'to_be_determined' }] },
    ],
    [
      'pending investigation external ID',
      {
        externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'pending_investigation' }],
      },
    ],
    [
      'punctuation-split placeholder external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'issue_T.B.D_123' }] },
    ],
    [
      'punctuation-split N-A external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'provider_N.A._123' }] },
    ],
    [
      'canonical exact na external ID',
      { externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'na' }] },
    ],
    [
      'embedded awaiting-investigation external ID',
      {
        externalObjectIds: [
          { ...validRow().externalObjectIds?.[0], id: 'provider.awaiting-investigation.123' },
        ],
      },
    ],
    [
      'embedded not-applicable external ID',
      {
        externalObjectIds: [{ ...validRow().externalObjectIds?.[0], id: 'row_not-applicable_123' }],
      },
    ],
    ['unexpected key', { unreviewed: true }],
    [
      'unexpected nested key',
      { sourceRevisions: [{ ...validRow().sourceRevisions?.[0], shortSha: '2657028' }] },
    ],
  ])('rejects %s', (_name, mutation) => {
    expect(validateRows([{ ...validRow(), ...mutation }]).valid).toBe(false);
  });

  it('enforces Linear native UUID identity', () => {
    const linear = {
      provider: 'linear',
      objectType: 'linear-issue',
      idKind: 'provider-native',
      id: '0f9fdd74-51b0-4fc4-b1a8-457100e9435a',
    };
    expect(validateRows([{ ...validRow(), externalObjectIds: [linear] }]).valid).toBe(true);
    expect(
      validateRows([{ ...validRow(), externalObjectIds: [{ ...linear, id: 'INT-123' }] }]).valid
    ).toBe(false);
    expect(
      validateRows([
        { ...validRow(), externalObjectIds: [{ ...linear, idKind: 'derived-canonical' }] },
      ]).valid
    ).toBe(false);
    expect(
      validateRows([{ ...validRow(), externalObjectIds: [{ ...linear, objectType: 'issue' }] }])
        .valid
    ).toBe(false);
  });

  it('allows Tasker only as a derived-canonical profile SHA-256', () => {
    const tasker = {
      provider: 'tasker',
      objectType: 'profile',
      idKind: 'derived-canonical',
      id: '13c7bb07f2d72b67c2d9883a596f75277c6a9cf847fa828553c26674156125ab',
    };
    expect(validateRows([{ ...validRow(), externalObjectIds: [tasker] }]).valid).toBe(true);
    expect(
      validateRows([
        { ...validRow(), externalObjectIds: [{ ...tasker, idKind: 'provider-native' }] },
      ]).valid
    ).toBe(false);
    expect(
      validateRows([
        { ...validRow(), externalObjectIds: [{ ...tasker, objectType: 'automation' }] },
      ]).valid
    ).toBe(false);
  });

  it('rejects human email addresses and raw user-home paths', () => {
    expect(
      validateRows([{ ...validRow(), conclusion: 'Approved by human@example.com' }]).valid
    ).toBe(false);
    expect(
      validateRows([
        { ...validRow(), artifactRelativePath: '/Users/example/private/artifact.json' },
      ]).valid
    ).toBe(false);
    expect(
      validateRows([{ ...validRow(), conclusion: 'Captured under /home/example/private' }]).valid
    ).toBe(false);
  });

  it('allows a technical GCP service-account principal only in its typed external ID', () => {
    const row = validRow();
    row.externalObjectIds = [
      {
        provider: 'gcp',
        objectType: 'service-account-principal',
        idKind: 'provider-native',
        id: 'investigator@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
      },
    ];

    expect(validateRows([row])).toEqual({ valid: true, errors: [] });

    row.conclusion = 'Observed by investigator@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    expect(validateRows([row]).valid).toBe(false);
  });

  it.each([
    'Authorization: Bearer redacted-but-still-a-token',
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'https://operator:password@example.invalid/path',
    'https://example.invalid/path?access_token=sensitive-value',
    '+48 123 456 789',
    'ghp_1234567890abcdefghijklmnopqrstuv',
    'api_key=sensitive-value',
  ])('rejects privacy-sensitive literal without echoing it: %s', (sensitiveValue) => {
    const result = validateRows([{ ...validRow(), conclusion: sensitiveValue }]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).not.toContain(sensitiveValue);
  });

  it.each([
    'ghp_1234567890abcdefghijklmnopqrstuv',
    'Authorization: Bearer sensitive-provider-id',
    'https://operator:password@example.invalid/resource',
    'https://example.invalid/resource?token=sensitive-value',
    'api_key=sensitive-value',
  ])('rejects high-confidence secret material in provider-native IDs: %s', (id) => {
    const row = validRow();
    row.externalObjectIds = [
      { provider: 'github', objectType: 'installation', idKind: 'provider-native', id },
    ];

    const result = validateRows([row]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).not.toContain(id);
  });

  it('allows phone-like digits only for allow-listed typed numeric provider IDs', () => {
    const metaRow = validRow();
    metaRow.externalObjectIds = [
      {
        provider: 'meta',
        objectType: 'phone-number-id',
        idKind: 'provider-native',
        id: '481234567890123',
      },
    ];
    const githubRow = validRow();
    githubRow.externalObjectIds = [
      {
        provider: 'github',
        objectType: 'installation',
        idKind: 'provider-native',
        id: '1234567890',
      },
    ];
    const arbitraryRow = validRow();
    arbitraryRow.externalObjectIds = [
      {
        provider: 'custom-provider',
        objectType: 'record',
        idKind: 'provider-native',
        id: '48123456789',
      },
    ];

    expect(validateRows([metaRow]).valid).toBe(true);
    expect(validateRows([githubRow]).valid).toBe(true);
    expect(validateRows([arbitraryRow]).valid).toBe(false);
  });

  it('rejects an appended timestamp earlier than the observation timestamp', () => {
    const result = validateRows([{ ...validRow(), appendedAt: '2026-08-28T00:27:47Z' }]);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('appendedAt');
  });

  it('round-trips UTC calendar dates instead of accepting normalized invalid dates', () => {
    const invalid = validateRows([
      {
        ...validRow(),
        observedAt: '2026-02-30T00:00:00Z',
        appendedAt: '2026-03-03T00:00:00Z',
      },
    ]);

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join('\n')).toContain('real UTC calendar timestamp');
    expect(
      validateRows([
        {
          ...validRow(),
          observedAt: '2024-02-29T00:00:00Z',
          appendedAt: '2024-02-29T00:00:00Z',
        },
      ]).valid
    ).toBe(true);
  });

  it.each([
    './m0-baseline/repositories.json',
    'm0-baseline/../repositories.json',
    'm0-baseline\\repositories.json',
    'm0-baseline//repositories.json',
  ])('rejects non-canonical artifact path %s', (artifactRelativePath) => {
    expect(validateRows([{ ...validRow(), artifactRelativePath }]).valid).toBe(false);
  });

  it('parses JSONL with stable one-based physical source line numbers', () => {
    const rows = parseLedgerJsonl(
      `${JSON.stringify(validRow())}\n\n${JSON.stringify({ ...validRow(), stepId: 'M0.2' })}\n`
    );

    expect(rows.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it('reports malformed JSONL without including the original line contents', () => {
    const secret = 'never echo this';

    expect(() => parseLedgerJsonl(`{"secret":"${secret}"\n`)).toThrow(
      'Invalid JSON on ledger line 1'
    );
    try {
      parseLedgerJsonl(`{"secret":"${secret}"\n`);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('requires every frozen CLI identity argument', () => {
    const fixture = createCliFixture();

    expect(() =>
      runLedgerValidatorCli(['--ledger', fixture.ledgerPath, '--schema', SCHEMA_PATH])
    ).toThrow('Usage:');
  });

  it('validates exact schema/run identity and real artifact files through the CLI', () => {
    const fixture = createCliFixture();
    const { exitCode, report } = runCli(requiredCliArgs(fixture));

    expect(exitCode).toBe(0);
    expect(report).toEqual({
      valid: true,
      rowCount: 1,
      schemaSha256: SCHEMA_SHA256,
      runId: RUN_ID,
      errors: [],
    });
  });

  it('rejects a schema whose exact bytes do not match the frozen SHA-256', () => {
    const fixture = createCliFixture();
    const { exitCode, report } = runCli(requiredCliArgs(fixture, { schemaSha256: '0'.repeat(64) }));

    expect(exitCode).toBe(1);
    expect(report.schemaSha256).toBe(SCHEMA_SHA256);
    expect(report.errors.join('\n')).toContain('schemaSha256');
  });

  it('rejects a foreign permissive schema even when expected SHA matches that file', () => {
    const fixture = createCliFixture();
    const schemaPath = path.join(fixture.directory, 'foreign.schema.json');
    const foreignSchema = Buffer.from(JSON.stringify({ type: 'object' }));
    writeFileSync(schemaPath, foreignSchema);

    const { exitCode, report } = runCli(
      requiredCliArgs(fixture, { schema: schemaPath, schemaSha256: sha256(foreignSchema) })
    );

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('embedded v1 trust root');
  });

  it('rejects an invalid JSON schema at the embedded trust-root boundary', () => {
    const fixture = createCliFixture();
    const schemaPath = path.join(fixture.directory, 'invalid.schema.json');
    const invalidSchema = Buffer.from(JSON.stringify({ type: 'not-a-json-schema-type' }));
    writeFileSync(schemaPath, invalidSchema);

    const { exitCode, report } = runCli(
      requiredCliArgs(fixture, { schema: schemaPath, schemaSha256: sha256(invalidSchema) })
    );

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('embedded v1 trust root');
  });

  it('uses physical JSONL line numbers in CLI validation errors', () => {
    const fixture = createCliFixture();
    writeFileSync(
      fixture.ledgerPath,
      `\n${JSON.stringify(validRow())}\n\n${JSON.stringify({ ...validRow(), runId: '20260828T002848Z-paddc4965d21e-b265702826912' })}\n`
    );

    const { exitCode, report } = runCli(requiredCliArgs(fixture));

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('ledger line 4/runId');
  });

  it('rejects an artifact whose bytes do not match the recorded SHA-256', () => {
    const fixture = createCliFixture([{ ...validRow(), artifactSha256: '0'.repeat(64) }]);

    const { exitCode, report } = runCli(requiredCliArgs(fixture));

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('artifactSha256');
  });

  it('rejects an artifact path that resolves outside the evidence root', () => {
    const fixture = createCliFixture([{ ...validRow(), artifactRelativePath: 'escape.json' }]);
    const outsidePath = path.join(fixture.directory, 'outside.json');
    writeFileSync(outsidePath, ARTIFACT_CONTENT);
    symlinkSync(outsidePath, path.join(fixture.evidenceRoot, 'escape.json'));

    const { exitCode, report } = runCli(requiredCliArgs(fixture));

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('contained regular file');
  });

  it('rejects a directory in place of a regular evidence artifact', () => {
    const fixture = createCliFixture([{ ...validRow(), artifactRelativePath: 'm0-baseline' }]);

    const { exitCode, report } = runCli(requiredCliArgs(fixture));

    expect(exitCode).toBe(1);
    expect(report.errors.join('\n')).toContain('contained regular file');
  });
});
