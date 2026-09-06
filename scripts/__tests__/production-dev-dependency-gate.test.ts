import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const verifierPath = resolve(repoRoot, 'scripts/verify-production-dev-dependencies.mjs');
const productionWebRendererPath = resolve(
  repoRoot,
  'scripts/render-production-web-service-env.mjs'
);
const policyRelativePath = 'config/environments/production-dev-dependency-allowlist.json';

interface AllowlistEntry {
  classification: string;
  expectedOccurrences: number;
  lineEquals: string;
  owner: string;
  path: string;
  reason: string;
}

interface BinaryAllowlistEntry {
  classification: string;
  owner: string;
  path: string;
  reason: string;
  sha256: string;
}

function write(root: string, relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writePolicy(
  root: string,
  allowlist: AllowlistEntry[],
  binaryAllowlist: BinaryAllowlistEntry[] = []
): void {
  write(
    root,
    policyRelativePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        forbiddenHost: 'dev.intexuraos.cloud',
        allowlist,
        binaryAllowlist,
      },
      null,
      2
    )}\n`
  );
}

function run(root: string, environment: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [verifierPath, '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

describe('production-to-DEV dependency regression gate', () => {
  it('fails for an unallowlisted production runtime dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-red-'));
    write(
      root,
      'config/environments/prod.json',
      '{"CALLBACK_URL":"https://dev.intexuraos.cloud/api/code"}\n'
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unallowlisted production-to-DEV dependency');
    expect(result.stderr).toContain('config/environments/prod.json:1');
  });

  it('passes only an exact allowlisted occurrence with an owner and reason', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-green-'));
    const line = '{"CALLBACK_URL":"https://dev.intexuraos.cloud/api/code"}';
    write(root, 'config/environments/prod.json', `${line}\n`);
    writePolicy(root, [
      {
        path: 'config/environments/prod.json',
        lineEquals: line,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'M4.1 cutover',
        reason: 'Removed when the production Matrix route changes to its production hostname.',
      },
    ]);

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Production-to-DEV dependency gate passed');
  });

  it('rejects the retired pending-milestone classification', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-pending-classification-'));
    const line = 'https://dev.intexuraos.cloud';
    write(root, 'docs/pending.md', `${line}\n`);
    writePolicy(root, [
      {
        path: 'docs/pending.md',
        lineEquals: line,
        expectedOccurrences: 1,
        classification: 'pending-milestone',
        owner: 'Retired transition state',
        reason: 'Final policy must classify every retained occurrence by permanent ownership.',
      },
    ]);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('classification is not allowed');
  });

  it('fails when an allowlist entry is stale or broader than one occurrence', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-stale-'));
    write(root, 'config/environments/prod.json', '{"CALLBACK_URL":"https://intexuraos.cloud"}\n');
    writePolicy(root, [
      {
        path: 'config/environments/prod.json',
        lineEquals: 'dev.intexuraos.cloud',
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'M4.1 cutover',
        reason: 'This entry must be deleted together with the dependency.',
      },
    ]);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Stale or non-exact allowlist entry');
  });

  it('requires the exact count when one allowlist line occurs more than once', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-repeated-'));
    const line = '{"FIRST":"https://dev.intexuraos.cloud","SECOND":"https://dev.intexuraos.cloud"}';
    write(root, 'config/environments/prod.json', `${line}\n`);
    writePolicy(root, [
      {
        path: 'config/environments/prod.json',
        lineEquals: line,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'M4.1 cutover',
        reason: 'Every forbidden occurrence requires its own exact reviewed allowlist entry.',
      },
    ]);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('matched 2 occurrences');

    writePolicy(root, [
      {
        path: 'config/environments/prod.json',
        lineEquals: line,
        expectedOccurrences: 2,
        classification: 'intentional-test',
        owner: 'M4.1 cutover',
        reason: 'Both exact occurrences are removed by the same reviewed production cutover.',
      },
    ]);

    const exactResult = run(root);
    expect(exactResult.status).toBe(0);
  });

  it('fails when duplicate allowlist entries cover one occurrence', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-duplicate-'));
    const line = '{"CALLBACK_URL":"https://dev.intexuraos.cloud/api/code"}';
    write(root, 'config/environments/prod.json', `${line}\n`);
    const entry: AllowlistEntry = {
      path: 'config/environments/prod.json',
      lineEquals: line,
      expectedOccurrences: 1,
      classification: 'intentional-test',
      owner: 'M4.1 cutover',
      reason: 'Only one reviewed allowlist entry may own each forbidden occurrence.',
    };
    writePolicy(root, [entry, entry]);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate allowlist entry');
  });

  it('fails closed on a symlink anywhere in a scanned directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-symlink-'));
    write(root, 'target.json', '{"CALLBACK_URL":"https://intexuraos.cloud"}\n');
    mkdirSync(join(root, 'config/environments'), { recursive: true });
    symlinkSync('../../target.json', join(root, 'config/environments/linked.json'));
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('symlink is forbidden in scanned scope');
  });

  it('rejects POSIX backslash filenames instead of normalizing them onto a decoy path', () => {
    if (sep !== '/') return;
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-backslash-path-'));
    write(root, 'safe/file.ts', "export const value = 'safe';\n");
    writeFileSync(join(root, 'safe\\file.ts'), "export const value = 'safe';\n");
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('non-canonical path');
  });

  it('fails closed on an unknown policy field', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-unknown-field-'));
    write(root, 'config/environments/prod.json', '{"CALLBACK_URL":"https://intexuraos.cloud"}\n');
    write(
      root,
      policyRelativePath,
      `${JSON.stringify({
        schemaVersion: 1,
        forbiddenHost: 'dev.intexuraos.cloud',
        scanPaths: [],
        allowlist: [],
      })}\n`
    );

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('policy has unknown keys: scanPaths');
  });

  it('fails closed on duplicate JSON object keys in the policy', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-duplicate-json-key-'));
    write(
      root,
      policyRelativePath,
      '{"schemaVersion":1,"schemaVersion":1,"forbiddenHost":"dev.intexuraos.cloud","allowlist":[],"binaryAllowlist":[]}\n'
    );

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate object key "schemaVersion"');
  });

  it('fails closed when policy attempts to redefine the forbidden production dependency host', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-wrong-host-'));
    write(
      root,
      'config/environments/prod.json',
      '{"CALLBACK_URL":"https://dev.intexuraos.cloud/api/code"}\n'
    );
    write(
      root,
      policyRelativePath,
      `${JSON.stringify({
        schemaVersion: 1,
        forbiddenHost: 'typo.dev.intexuraos.cloud',
        allowlist: [],
      })}\n`
    );

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('forbiddenHost must be exactly dev.intexuraos.cloud');
  });

  it('discovers app, docs, IaC, and unknown-extension text without a policy-controlled catalog', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-global-universe-'));
    write(
      root,
      'apps/new-service/src/runtime.unknown',
      "export const callback = 'https://DEV.INTEXURAOS.CLOUD./api/code';\n"
    );
    write(root, 'docs/history.md', 'Historical https://dev.intexuraos.cloud reference\n');
    write(root, 'terraform/hetzner-prod/cloud-init.yaml.tftpl', 'DEV.INTEXURAOS.CLOUD\n');
    write(root, 'dist/runtime-input.custom', 'https://dev.intexuraos.cloud/from-dist\n');
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('apps/new-service/src/runtime.unknown:1');
    expect(result.stderr).toContain('docs/history.md:1');
    expect(result.stderr).toContain('terraform/hetzner-prod/cloud-init.yaml.tftpl:1');
    expect(result.stderr).toContain('dist/runtime-input.custom:1');
  });

  it('never falls back to a narrower filesystem walk when a Git repository is unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-git-failure-'));
    mkdirSync(join(root, '.git'));
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot resolve Git repository inventory');
  });

  it('fails when the Git inventory changes during the scan', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-inventory-change-'));
    const bin = join(root, 'fake-bin');
    const counter = join(root, 'git-inventory-count');
    mkdirSync(join(root, '.git'));
    mkdirSync(bin);
    writePolicy(root, []);
    const fakeGit = join(bin, 'git');
    writeFileSync(
      fakeGit,
      `#!/usr/bin/env node
const { existsSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('rev-parse')) {
  process.stdout.write(process.env.GATE_TEST_ROOT + '\\n');
} else if (args.includes('ls-files')) {
  const changed = existsSync(process.env.GATE_TEST_COUNTER);
  writeFileSync(process.env.GATE_TEST_COUNTER, 'seen');
  process.stdout.write('config/environments/production-dev-dependency-allowlist.json\\0');
  if (changed) process.stdout.write('apps/new-runtime.ts\\0');
} else {
  process.exitCode = 2;
}
`
    );
    chmodSync(fakeGit, 0o755);

    const result = run(root, {
      GATE_TEST_COUNTER: counter,
      GATE_TEST_ROOT: root,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Repository inventory changed while the scan was running');
  });

  it('fails when a scanned file changes after its first stable read', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-content-change-'));
    const bin = join(root, 'fake-bin');
    const counter = join(root, 'git-inventory-count');
    const runtimePath = join(root, 'apps/runtime.ts');
    mkdirSync(join(root, '.git'));
    mkdirSync(bin);
    write(root, 'apps/runtime.ts', "export const endpoint = 'https://intexuraos.cloud';\n");
    writePolicy(root, []);
    const fakeGit = join(bin, 'git');
    writeFileSync(
      fakeGit,
      `#!/usr/bin/env node
const { existsSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('rev-parse')) {
  process.stdout.write(process.env.GATE_TEST_ROOT + '\\n');
} else if (args.includes('ls-files')) {
  const changed = existsSync(process.env.GATE_TEST_COUNTER);
  writeFileSync(process.env.GATE_TEST_COUNTER, 'seen');
  if (changed) {
    writeFileSync(process.env.GATE_TEST_RUNTIME, "export const endpoint = 'https://dev.intexuraos.cloud';\\n");
  }
  process.stdout.write('apps/runtime.ts\\0config/environments/production-dev-dependency-allowlist.json\\0');
} else {
  process.exitCode = 2;
}
`
    );
    chmodSync(fakeGit, 0o755);

    const result = run(root, {
      GATE_TEST_COUNTER: counter,
      GATE_TEST_ROOT: root,
      GATE_TEST_RUNTIME: runtimePath,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Scanned file changed after its canonical dependency check: apps/runtime.ts'
    );
  });

  it('detects hostname spellings normalized by URL parsers', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-host-normalization-'));
    const runtimeLines = [
      "const caseAndRootDot = 'https://DEV.INTEXURAOS.CLOUD.:443/api';",
      "const percentBytes = 'https://d%65v%E3%80%82intexuraos%EF%BC%8Ecloud/api';",
      "const unicodeDots = 'https://dev。intexuraos．cloud/api';",
      "const fullwidth = 'https://ｄｅｖ．ｉｎｔｅｘｕｒａｏｓ．ｃｌｏｕｄ/api';",
      "const circled = 'https://ⓓⓔⓥ.ⓘⓝⓣⓔⓧⓤⓡⓐⓞⓢ.ⓒⓛⓞⓤⓓ/api';",
      `const mappedToNothing = 'https://de${String.fromCodePoint(0x00ad)}v.intexuraos.cloud/api';`,
      String.raw`const escapedLetters = 'https://\x64\u0065\u{76}\u002eintexuraos\x2ecloud/api';`,
      String.raw`const paddedCodePoint = 'https://dev\u{00002e}intexuraos\u{3002}cloud/api';`,
      String.raw`const identityEscaped = 'https://\dev\.intexuraos\.cloud/api';`,
      String.raw`const escapedPercent = 'https://dev\x252eintexuraos\u00252ecloud/api';`,
      "const legacyOctal = 'https://\\144\\145\\166\\56intexuraos\\056cloud/api';",
      String.raw`const yamlHcl = "https://\U00000064\u0065v\U0000002Eintexuraos.cloud/api";`,
      String.raw`const ansiC = $'https://dev\t.intexuraos.\x63loud/api';`,
      String.raw`const ansiControl = $'https://de\cIv.intexuraos.cloud/api';`,
      String.raw`const css = url(https://\64 \65 \76 \2e intexuraos\2e cloud/api);`,
      "const html = 'https://&#100;&#101;&#118;&period;intexuraos&#x2e;cloud/api';",
      "const htmlNamed = 'https://de&shy;v&percnt;2eintexuraos&period;cloud/api';",
      "const htmlNestedJs = 'https://dev&bsol;u002eintexuraos&bsol;u002ecloud/api';",
      "const htmlNestedCss = 'https://dev&bsol;2e intexuraos&bsol;2e cloud/api';",
      "const continued = 'https://dev.intexuraos.\\",
      "cloud/api';",
      'url: "https://de\\',
      '  v.intexuraos.cloud/api"',
    ];
    write(root, 'apps/service/src/runtime.ts', runtimeLines.join('\n'));
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    for (const line of [...Array.from({ length: 20 }, (_value, index) => index + 1), 22]) {
      expect(result.stderr).toContain(`apps/service/src/runtime.ts:${String(line)}:`);
    }
  });

  it('detects encoded hosts and common statically computable string expressions', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-literal-boundary-'));
    write(
      root,
      'apps/service/src/runtime.ts',
      [
        "const recursivelyEncoded = 'https://dev%252eintexuraos%252ecloud/api';",
        "const computed = 'https://dev' + '.intexuraos' + '.cloud/api';",
        "const directTemplate = `https://${'dev'}.intexuraos.cloud/api`;",
        "const label = 'dev'; const indirectTemplate = `https://${label}.intexuraos.cloud/api`;",
        "const joined = ['dev', 'intexuraos', 'cloud'].join('.');",
        "const wrapped = 'https://' + String('dev') + '.intexuraos.cloud/api';",
        "const decoded = Buffer.from('aHR0cHM6Ly9kZXYuaW50ZXh1cmFvcy5jbG91ZC9hcGk=', 'base64').toString('utf8');",
        "const escapedTemplate = `https://${'\\x64\\x65\\x76'}.intexuraos.cloud/api`;",
        "const escapedLabel = '\\u0064ev'; const escapedIndirect = `https://${escapedLabel}.intexuraos.cloud/api`;",
        "const splitJoined = ['d', 'e', 'v', '.', 'intexuraos', '.', 'cloud'].join('');",
        "const exportHost = 'dev'; export default `https://${exportHost}.intexuraos.cloud/api`;",
        "const classHost = 'dev'; class Endpoint { url = `https://${classHost}.intexuraos.cloud/api`; }",
        "const arrowHost = 'dev'; const getEndpoint = () => `https://${arrowHost}.intexuraos.cloud/api`;",
      ].join('\n')
    );
    write(
      root,
      'apps/service/src/runtime.tsx',
      "const jsxHost = 'dev'; const link = <a href={`https://${jsxHost}.intexuraos.cloud/api`} />;\n"
    );
    write(
      root,
      'apps/service/src/escaped.ts',
      [
        "const first = `https://${'\\x64\\x65\\x76'}.intexuraos.cloud/api`;",
        "const encodedLabel = '\\u0064ev'; const second = `https://${encodedLabel}.intexuraos.cloud/api`;",
        "const third = ['d', 'e', 'v', '.', 'intexuraos', '.', 'cloud'].join('');",
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    for (let line = 1; line <= 13; line += 1) {
      expect(result.stderr).toContain(`apps/service/src/runtime.ts:${String(line)}:`);
    }
    expect(result.stderr).toContain('apps/service/src/runtime.tsx:1:');
    for (let line = 1; line <= 3; line += 1) {
      expect(result.stderr).toContain(`apps/service/src/escaped.ts:${String(line)}:`);
    }
  });

  it('detects a GitHub Actions URL assembled from an unambiguous literal env value', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-env-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'name: deploy',
        'env:',
        '  DEV_LABEL: dev',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: deploy --callback "https://${{ env.DEV_LABEL }}.intexuraos.cloud/api/code"',
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.github/workflows/deploy.yml:8:');
  });

  it('cannot suppress a workflow finding with a conflicting env value in another job', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-scope-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'jobs:',
        '  unsafe:',
        '    env:',
        '      DEV_LABEL: dev',
        '    steps:',
        '      - run: deploy "https://${{ env.DEV_LABEL }}.intexuraos.cloud/api/code"',
        '  harmless:',
        '    env:',
        '      DEV_LABEL: prod',
        '    steps:',
        '      - run: echo "${{ env.DEV_LABEL }}"',
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.github/workflows/deploy.yml:6:');
  });

  it('detects quoted, bracket, anchored, and inline workflow env syntax', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-syntax-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'env: { INLINE_LABEL: dev }',
        'jobs:',
        '  deploy:',
        '    env:',
        '      "QUOTED_LABEL": dev',
        '      ANCHORED_LABEL: &devlabel dev',
        '    steps:',
        '      - run: use "https://${{ env[\'INLINE_LABEL\'] }}.intexuraos.cloud/inline"',
        '      - run: use "https://${{ env["QUOTED_LABEL"] }}.intexuraos.cloud/quoted"',
        '      - run: use "https://${{ env.ANCHORED_LABEL }}.intexuraos.cloud/anchor"',
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    for (const line of [8, 9, 10]) {
      expect(result.stderr).toContain(`.github/workflows/deploy.yml:${String(line)}:`);
    }
  });

  it('detects sequence env maps, aliases, YAML hex escapes, and multiline expressions', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-yaml-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'name: deploy',
        'env:',
        '  LABEL_ANCHOR: &devlabel dev',
        '  ALIAS_LABEL: *devlabel',
        '  ESCAPED_LABEL: "\\x64ev"',
        'jobs:',
        '  deploy:',
        '    steps:',
        '      - env: { SEQUENCE_LABEL: dev }',
        '        run: use "https://${{ env.SEQUENCE_LABEL }}.intexuraos.cloud/sequence"',
        '      - run: use "https://${{ env.ALIAS_LABEL }}.intexuraos.cloud/alias"',
        '      - run: use "https://${{ env.ESCAPED_LABEL }}.intexuraos.cloud/escaped"',
        '      - run: >-',
        '          use "https://${{',
        '            env.ALIAS_LABEL',
        '          }}.intexuraos.cloud/multiline"',
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    for (const line of [10, 11, 12, 14]) {
      expect(result.stderr).toContain(`.github/workflows/deploy.yml:${String(line)}:`);
    }
  });

  it.each([
    ['block scalar', ['env:', '  DEV_LABEL: >-', '    dev']],
    ['eight-digit YAML escape', ['env:', '  DEV_LABEL: "\\U00000064ev"']],
    ['numeric anchor', ['env:', '  SOURCE: &1 dev', '  DEV_LABEL: *1']],
    ['anchored env map', ['defaults: &dev_env', '  DEV_LABEL: dev', 'env: *dev_env']],
  ])('fails closed for an unresolved relevant workflow env %s', (_label, definitionLines) => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-unresolved-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        ...definitionLines,
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: use "https://${{ env.DEV_LABEL }}.intexuraos.cloud/api"',
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved relevant GitHub Actions env DEV_LABEL');
    expect(result.stderr).toContain('.github/workflows/deploy.yml');
  });

  it.each([
    ['middle label fragment', 'https://d${{ env.E }}v.intexuraos.cloud/x'],
    ['leading label fragment', 'https://${{ env.E }}ev.intexuraos.cloud/x'],
    ['middle domain fragment', 'https://dev.inte${{ env.E }}uraos.cloud/x'],
    ['quoted middle fragment', 'https://d"${{ env.E }}"v.intexuraos.cloud/x'],
    ['ANSI-C quoted middle fragment', "https://d$'${{ env.E }}'v.intexuraos.cloud/x"],
    [
      'Unicode compatibility fragment',
      'https://ｄ${{ env.E }}ｖ.ｉｎｔｅｘｕｒａｏｓ.ｃｌｏｕｄ/x',
    ],
  ])('fails closed when an unresolved env is a %s', (_label, url) => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-fragment-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'env:',
        '  E: >-',
        '    e',
        'jobs:',
        '  unsafe:',
        '    steps:',
        `      - run: curl ${url}`,
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved relevant GitHub Actions env E');
  });

  it('detects literal GitHub Actions format expressions and shell-adjacent quotes', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-format-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl ${{ format('https://{0}.intexuraos.cloud/x', 'dev') }}",
        '      - run: curl "https://d""ev.intexuraos.cloud/x"',
        '      - run: curl https://d"e"v.intexuraos.cloud/x',
        "      - run: curl https://$'d'$'ev.intexuraos.cloud/x'",
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.github/workflows/deploy.yml:4:');
    expect(result.stderr).toContain('.github/workflows/deploy.yml:5:');
    expect(result.stderr).toContain('.github/workflows/deploy.yml:6:');
    expect(result.stderr).toContain('.github/workflows/deploy.yml:7:');
  });

  it('resolves workflow format arguments from env and fails closed when relevant input is unknown', () => {
    const knownRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-format-env-'));
    write(
      knownRoot,
      '.github/workflows/deploy.yml',
      [
        'env:',
        '  E: e',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl ${{ format('https://d{0}v.intexuraos.cloud/x', env.E) }}",
      ].join('\n')
    );
    writePolicy(knownRoot, []);

    const known = run(knownRoot);

    expect(known.status).toBe(1);
    expect(known.stderr).toContain('.github/workflows/deploy.yml:6:');

    const unknownRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-format-unknown-'));
    write(
      unknownRoot,
      '.github/workflows/deploy.yml',
      [
        'env:',
        '  E: >-',
        '    e',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl ${{ format('https://d{0}v.intexuraos.cloud/x', env.E) }}",
      ].join('\n')
    );
    writePolicy(unknownRoot, []);

    const unknown = run(unknownRoot);

    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unresolved relevant GitHub Actions format expression');

    const prefixedRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-format-prefixed-'));
    write(
      prefixedRoot,
      '.github/workflows/deploy.yml',
      [
        'env:',
        '  X: >-',
        '    dev',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: ${{ format('curl {0}.intexuraos.cloud/x', env.X) }}",
      ].join('\n')
    );
    writePolicy(prefixedRoot, []);

    const prefixed = run(prefixedRoot);

    expect(prefixed.status).toBe(1);
    expect(prefixed.stderr).toContain('unresolved relevant GitHub Actions format expression');
  });

  it('does not classify a standalone unresolved workflow env reference as a host', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-harmless-env-'));
    write(
      root,
      '.github/workflows/check.yml',
      ['jobs:', '  check:', '    steps:', '      - run: echo "${{ env.MISSING }}"'].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it('composes workflow env and format folds on the same mapped candidate', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-composition-'));
    write(
      root,
      '.github/workflows/deploy.yml',
      [
        'env:',
        '  D: dev',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl https://${{ env.D }}.${{ format('{0}.cloud', 'intexuraos') }}",
      ].join('\n')
    );
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.github/workflows/deploy.yml:6:');
  });

  it.each([
    [
      'env before format',
      [
        'env:',
        '  D: >-',
        '    dev',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl https://${{ env.D }}.${{ format('{0}.cloud', 'intexuraos') }}",
      ],
    ],
    [
      'format before env',
      [
        'env:',
        '  DOMAIN: >-',
        '    intexuraos.cloud',
        'jobs:',
        '  unsafe:',
        '    steps:',
        "      - run: curl https://${{ format('{0}', 'dev') }}.${{ env.DOMAIN }}",
      ],
    ],
  ])('fails closed for unresolved %s after composing format', (_label, lines) => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-unresolved-mixed-'));
    write(root, '.github/workflows/deploy.yml', lines.join('\n'));
    writePolicy(root, []);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved relevant GitHub Actions env');
  });

  it('allows only the exact discovered workflow sink line', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-workflow-policy-'));
    const seedLine = '  DEV_LABEL: dev';
    const sinkLine = '  CALLBACK_URL: https://${{ env.DEV_LABEL }}.intexuraos.cloud/api/code';
    write(root, '.github/workflows/deploy.yml', `env:\n${seedLine}\n${sinkLine}\n`);
    writePolicy(root, [
      {
        path: '.github/workflows/deploy.yml',
        lineEquals: sinkLine,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'Workflow dependency fixture',
        reason: 'The exact statically resolved workflow sink is reviewed by this gate fixture.',
      },
    ]);

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 exact allowlisted occurrence');
  });

  it('allows an exact policy line for a statically computed occurrence', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-computed-policy-'));
    const seedLine = "const host = 'dev.intexuraos.cloud';";
    const sinkLine = 'report(`forbidden callback ${host}`);';
    write(root, 'apps/service/src/runtime.ts', `${seedLine}\n${sinkLine}\n`);
    writePolicy(root, [
      {
        path: 'apps/service/src/runtime.ts',
        lineEquals: seedLine,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'Computed dependency fixture',
        reason: 'The direct constant seed is retained only by this dependency-gate fixture.',
      },
      {
        path: 'apps/service/src/runtime.ts',
        lineEquals: sinkLine,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'Computed dependency fixture',
        reason: 'A computed occurrence remains representable by its exact reviewed source line.',
      },
    ]);

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('2 exact allowlisted occurrences');
  });

  it('fails closed on malformed UTF-8 and NUL bytes', () => {
    const malformedRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-malformed-'));
    writePolicy(malformedRoot, []);
    const malformedPath = join(malformedRoot, 'apps', 'service', 'src', 'runtime.ts');
    mkdirSync(dirname(malformedPath), { recursive: true });
    writeFileSync(malformedPath, Buffer.from([0xc3, 0x28]));
    const malformedResult = run(malformedRoot);
    expect(malformedResult.status).toBe(1);
    expect(malformedResult.stderr).toContain('valid UTF-8');

    const nulRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-nul-'));
    writePolicy(nulRoot, []);
    const nulPath = join(nulRoot, 'apps', 'service', 'src', 'runtime.ts');
    mkdirSync(dirname(nulPath), { recursive: true });
    writeFileSync(nulPath, Buffer.from("const value = 'safe';\0\n"));
    const nulResult = run(nulRoot);
    expect(nulResult.status).toBe(1);
    expect(nulResult.stderr).toContain('NUL byte');
  });

  it('allows only an exact hashed intentional binary fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-binary-allowlist-'));
    const relativePath = 'workers/orchestrator/src/__tests__/fixtures/sample.rawlogs.txt';
    const path = join(root, ...relativePath.split('/'));
    const contents = Buffer.from('fixture\0https://dev.intexuraos.cloud\n');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    writePolicy(
      root,
      [],
      [
        {
          path: relativePath,
          sha256: createHash('sha256').update(contents).digest('hex'),
          classification: 'intentional-test',
          owner: 'Completion verifier fixtures',
          reason:
            'The exact binary test corpus is pinned by SHA-256 and never enters production routing.',
        },
      ]
    );

    expect(run(root).status).toBe(0);
    writeFileSync(path, Buffer.from('changed\0fixture\n'));
    const changed = run(root);
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain('binary allowlist hash mismatch');

    const textRoot = mkdtempSync(join(tmpdir(), 'production-dev-gate-binary-text-bypass-'));
    const textPath = 'apps/service/src/runtime.ts';
    const textContents = Buffer.from("export const owner = 'https://dev.intexuraos.cloud';\n");
    write(textRoot, textPath, textContents.toString('utf8'));
    writePolicy(
      textRoot,
      [],
      [
        {
          path: textPath,
          sha256: createHash('sha256').update(textContents).digest('hex'),
          classification: 'intentional-test',
          owner: 'Bypass regression fixture',
          reason: 'A binary exception must never be able to suppress valid UTF-8 routing source.',
        },
      ]
    );
    const textBypass = run(textRoot);
    expect(textBypass.status).toBe(1);
    expect(textBypass.stderr).toContain('cannot hide a valid UTF-8 text file');
  });

  it('rejects owner and reason values padded with whitespace', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-dev-gate-padded-metadata-'));
    const line = 'https://dev.intexuraos.cloud';
    write(root, 'config/environments/prod.json', `${line}\n`);
    writePolicy(root, [
      {
        path: 'config/environments/prod.json',
        lineEquals: line,
        expectedOccurrences: 1,
        classification: 'intentional-test',
        owner: 'x  ',
        reason: 'x           ',
      },
    ]);

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not have leading or trailing whitespace');
  });

  it('keeps retained DEV service wiring out of the production web renderer', () => {
    const root = mkdtempSync(join(tmpdir(), 'production-web-renderer-sentinel-'));
    const manifest = join(root, 'apps/web/service-manifest.json');
    const envFile = join(root, 'prod.env');
    const captureEnvironment = join(root, 'captured-build.env');
    const captureDotenv = join(root, 'captured-dotenv');
    const publishedRoot = join(root, 'published');
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(fakeBin);
    writeFileSync(
      join(root, 'scripts/render-production-web-service-env.mjs'),
      readFileSync(productionWebRendererPath)
    );
    writeFileSync(
      manifest,
      `${JSON.stringify({
        services: [
          {
            envSuffix: 'SENTINEL',
            apiPath: '/api/sentinel',
            serviceUrl: 'https://dev.intexuraos.cloud/must-not-render',
          },
        ],
      })}\n`
    );
    writeFileSync(
      envFile,
      [
        'INTEXURAOS_AUTH0_DOMAIN=auth.example.test',
        'INTEXURAOS_AUTH0_SPA_CLIENT_ID=client',
        'INTEXURAOS_AUTH_AUDIENCE=audience',
        'INTEXURAOS_FIREBASE_PROJECT_ID=project',
        'INTEXURAOS_FIREBASE_API_KEY=key',
        'INTEXURAOS_FIREBASE_AUTH_DOMAIN=firebase.example.test',
        'INTEXURAOS_SENTRY_DSN_WEB=https://sentry.example.test/1',
      ].join('\n') + '\n'
    );
    const fakePnpm = join(fakeBin, 'pnpm');
    writeFileSync(
      fakePnpm,
      `#!/usr/bin/env bash
set -euo pipefail
env | LC_ALL=C sort > "${captureEnvironment}"
cp apps/web/.env.production.local "${captureDotenv}"
mkdir -p apps/web/dist
printf '<html>sentinel</html>\\n' > apps/web/dist/index.html
`
    );
    chmodSync(fakePnpm, 0o755);
    const fakeRsync = join(fakeBin, 'rsync');
    writeFileSync(
      fakeRsync,
      `#!/usr/bin/env bash
set -euo pipefail
source_path="\${@: -2:1}"
destination_path="\${@: -1}"
mkdir -p "\${destination_path}"
cp -R "\${source_path%/}/." "\${destination_path}/"
`
    );
    chmodSync(fakeRsync, 0o755);
    const rendered = spawnSync(process.execPath, [productionWebRendererPath, manifest], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const deployed = spawnSync(
      'bash',
      [
        resolve(repoRoot, 'scripts/hetzner/deploy-web.sh'),
        '--repo-dir',
        root,
        '--env-file',
        envFile,
        '--web-root',
        publishedRoot,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          COMMIT_MESSAGE: 'renderer sentinel',
          COMMIT_SHA: 'a'.repeat(40),
          GATE_CAPTURE_DOTENV: captureDotenv,
          GATE_CAPTURE_ENVIRONMENT: captureEnvironment,
          INTEXURAOS_ENVIRONMENT: 'prod',
          NODE_PATH: resolve(repoRoot, 'node_modules'),
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
      }
    );
    const deployWeb = readFileSync(resolve(repoRoot, 'scripts/hetzner/deploy-web.sh'), 'utf8');
    const buildEnvironment = readFileSync(captureEnvironment, 'utf8');
    const sanitizedDotenv = readFileSync(captureDotenv, 'utf8');

    expect(rendered.status).toBe(0);
    expect(rendered.stdout).toBe('INTEXURAOS_SENTINEL_URL\t/api/sentinel\n');
    expect(rendered.stdout).not.toContain('dev.intexuraos.cloud');
    expect(deployed.status, deployed.stderr).toBe(0);
    expect(buildEnvironment).toContain('INTEXURAOS_SENTINEL_URL=/api/sentinel\n');
    expect(sanitizedDotenv).toContain('INTEXURAOS_SENTINEL_URL="/api/sentinel"\n');
    expect(`${buildEnvironment}\n${sanitizedDotenv}`).not.toContain('dev.intexuraos.cloud');
    expect(readFileSync(join(publishedRoot, 'index.html'), 'utf8')).toContain('sentinel');
    expect(deployWeb.match(/render-production-web-service-env\.mjs/gu)).toHaveLength(2);
  });

  it('contains no unfinished milestone classification in the tracked final policy', () => {
    const policy = JSON.parse(readFileSync(resolve(repoRoot, policyRelativePath), 'utf8')) as {
      allowlist: AllowlistEntry[];
      binaryAllowlist: BinaryAllowlistEntry[];
    };

    expect(
      [...policy.allowlist, ...policy.binaryAllowlist].filter(
        (entry) => entry.classification === 'pending-milestone'
      )
    ).toEqual([]);
  });

  it('is wired directly into local and GitHub CI', () => {
    const ci = readFileSync(resolve(repoRoot, 'scripts/ci.mjs'), 'utf8');
    const githubCi = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(ci.match(/script: 'verify-production-dev-dependencies\.mjs'/gu)).toHaveLength(1);
    expect(ci).toMatch(
      /name: 'Production Dependency Gate',\n\s+parallel: false,\n\s+commands: \[\n\s+\{\n\s+name: 'production-dev-dependencies',\n\s+script: 'verify-production-dev-dependencies\.mjs'/u
    );
    expect(githubCi).toContain(
      '- name: Validate Production-to-DEV Dependencies\n        run: node scripts/verify-production-dev-dependencies.mjs'
    );
    expect(packageJson.scripts['verify:production-dev-dependencies']).toBe(
      'node scripts/verify-production-dev-dependencies.mjs'
    );
  });

  it.runIf(process.env['INTEXURAOS_RUN_TRACKED_PRODUCTION_DEV_GATE_TEST'] === '1')(
    'passes against the tracked policy',
    () => {
      const result = run(repoRoot);

      expect(result.status).toBe(0);
    },
    900_000
  );
});
