import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const runbookPath = resolve(repositoryRoot, 'docs/testing/intex-agent-evals.md');
const technicalReferencePath = resolve(repositoryRoot, 'docs/services/intex-agent/technical.md');
const UNSUPPORTED_MARKDOWN_LINK_SYNTAX = 'Unsupported Markdown link syntax';

const REQUIRED_SECTIONS = [
  '## Scope and safety',
  '## Protected machine-local configuration',
  '## Tracked inputs and private outputs',
  '## Exact commands',
  '## Deliberately deferred hardening',
  '## Exit codes and triage',
] as const;

const OFFLINE_COMMANDS = [
  'pnpm --filter @intexuraos/intex-agent-evals validate',
  'pnpm --filter @intexuraos/intex-agent-evals test',
  'pnpm exec vitest run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts',
  'pnpm run ci:tracked',
] as const;

const LIVE_WRAPPER_COMMANDS = [
  'scripts/run-intex-agent-evals-home-dev.sh setup',
  'scripts/run-intex-agent-evals-home-dev.sh preflight',
  'scripts/run-intex-agent-evals-home-dev.sh endpoint',
  'scripts/run-intex-agent-evals-home-dev.sh scenario intex-eval-003',
  'scripts/run-intex-agent-evals-home-dev.sh matrix-smoke',
  'scripts/run-intex-agent-evals-home-dev.sh full',
  'scripts/run-intex-agent-evals-prod.sh matrix-corpus',
] as const;

const CONFIG_FIELDS = [
  'schemaVersion',
  'accountAlias',
  'userId',
  'matrixUserId',
  'matrixAccessTokenFile',
  'matrixOutboundAuthTokenFile',
  'matrixTargetsFile',
] as const;

interface MarkdownDocument {
  readonly path: string;
  readonly contents: string;
}

let runbook = '';
let technicalReference = '';

beforeAll(async () => {
  [runbook, technicalReference] = await Promise.all([
    readOptionalFile(runbookPath),
    readFile(technicalReferencePath, 'utf8'),
  ]);
});

describe('Intex Agent evaluation documentation', () => {
  it('provides the runbook with exactly the required sections', async () => {
    const stat = await optionalLstat(runbookPath);
    expect(stat?.isFile()).toBe(true);

    const headings = runbook.split(/\r?\n/u).filter((line) => line.startsWith('## '));
    expect(headings).toEqual(REQUIRED_SECTIONS);
  });

  it('documents the exact offline and live command forms', () => {
    const lines = new Set(runbook.split(/\r?\n/u));
    for (const command of [...OFFLINE_COMMANDS, ...LIVE_WRAPPER_COMMANDS]) {
      expect(lines).toContain(command);
    }

    expect(runbook).toContain('**LIVE — requires “odpal testy”**');
    expect(runbook).toContain('Preparation commands never run the wrapper.');
    expect(runbook).not.toContain('--scenario');
  });

  it('documents fixed runtime, protected configuration, inputs, outputs, and exits', () => {
    for (const fact of [
      'home-dev',
      'https://intexuraos.cloud',
      'hetzner-prod',
      '$HOME/deploy/intexuraos',
      '`8134`',
      '`8113`',
      '`8099`',
      '~/.config/intexuraos/intex-agent-evals.json',
      'tools/intex-agent-evals/scenarios/*.scenario.json',
      '$HOME/deploy/intexuraos/.artifacts/intex-agent-evals/<eval-run-id>/',
      'or:minimax/minimax-m3',
    ]) {
      expect(runbook).toContain(fact);
    }
    expect(runbook).toContain(
      'The instruction **“odpal testy” means exactly one invocation of `matrix-corpus`**.'
    );
    expect(runbook).toContain(
      '`scripts/run-intex-agent-evals-home-dev.sh matrix-corpus` exits before Git, SSH, or any'
    );
    expect(runbook).toContain('`MODE=hibernated`');
    expect(runbook).toContain('`DEV_RUNTIME_HIBERNATED`');
    expect(runbook).toMatch(/production `matrix-corpus` wrapper is exempt/u);
    expect(runbook).toContain('20 scenarios and 60 turns');
    expect(runbook).toContain('or:deepseek/deepseek-v4-flash');

    for (const field of CONFIG_FIELDS) {
      expect(runbook).toContain(`"${field}"`);
    }
    expect(runbook).toContain(
      '`matrixOutboundAuthTokenFile` is distinct from `matrixAccessTokenFile`'
    );
    expect(runbook).toContain(
      '`GET http://127.0.0.1:8099/health` requires `Authorization: Bearer`'
    );
    expect(runbook).toContain('"schemaVersion": 2');
    expect(runbook).toContain('`CONFIG_UPGRADE_REQUIRED`');
    expect(runbook).toContain('`setup result PASS upgraded`');
    expect(runbook).toContain('atomically replaces the protected version-one file');
    expect(runbook).toContain('fsyncs the containing directory before reporting success');
    expect(runbook).toContain('fsyncs the directory again after removing the upgrade lock');

    expect(runbook).toContain(
      '| `0` | All executed deterministic and MiniMax checks passed. | Preserve report path and continue. |'
    );
    expect(runbook).toContain(
      '| `1` | Behavioral failure. | Preserve the report, correct the failed scenarios, deploy, and automatically run the production corpus again. |'
    );
    expect(runbook).toContain(
      '| `2` | Configuration, revision, connectivity, cleanup, judge, Matrix, or reporting infrastructure failure. | Preserve safe code/output, correct the named boundary, deploy, and automatically run the production corpus again. |'
    );
  });

  it('keeps the documentation free of forbidden model and real account data', () => {
    const changedDocumentation = `${runbook}\n${technicalReference}`;
    expect(changedDocumentation).not.toMatch(/sonnet/iu);
    expect(changedDocumentation).not.toMatch(/@pbuchman\.com/iu);
  });

  it('documents the delivered endpoint limit and links the runbook', () => {
    expect(technicalReference).toContain(
      'Requests accept 1 through exactly 20 turns and reject 0 or 21.'
    );
    expect(technicalReference).toContain(
      'The independent provider tool-loop limit remains unchanged.'
    );
    expect(technicalReference).toContain(
      '[Intex Agent evaluation runbook](../../testing/intex-agent-evals.md)'
    );
  });

  it('extracts standard inline and image destinations', () => {
    const markdown = [
      '[Bare inline](docs/services/intex-agent/technical.md)',
      '[Angle inline](<docs/testing/evaluation runbook.md> "Runbook")',
      '![Bare image](docs/testing/evaluation-report.png)',
      '![Angle image](<docs/testing/evaluation chart.png>)',
    ].join('\n');

    expect(markdownLinkTargets(markdown)).toEqual([
      'docs/services/intex-agent/technical.md',
      'docs/testing/evaluation runbook.md',
      'docs/testing/evaluation-report.png',
      'docs/testing/evaluation chart.png',
    ]);
  });

  it('extracts both targets from a linked image', () => {
    expect(
      markdownLinkTargets('[![badge](../../../../outside.png)](../../testing/intex-agent-evals.md)')
    ).toEqual(['../../../../outside.png', '../../testing/intex-agent-evals.md']);
  });

  it('extracts escaped, empty, and nested labels with balanced bare destinations', () => {
    const markdown = [
      '\\[](../../ignored.md)',
      '[](../../outside.md)',
      '[outer [inner]](../../outside.md)',
      '[escaped \\] label](../../escaped.md)',
      '[x](../../outside(foo).md)',
    ].join('\n');

    expect(markdownLinkTargets(markdown)).toEqual([
      '../../outside.md',
      '../../outside.md',
      '../../escaped.md',
      '../../outside(foo).md',
    ]);
  });

  it('rejects reference definitions wherever the literal definition token appears', () => {
    const markdownSamples = [
      '[id]: ../../outside.md',
      '[x][id]\n\n[id]:\n  ../../outside.md',
      '[Angle reference][angle-reference]\n' +
        '[angle-reference]: <docs/testing/reference runbook.md> "Reference runbook"',
      '[Bare reference][bare-reference]\n' +
        '[bare-reference]: docs/services/intex-agent/technical.md',
      '> [id]: ../../outside.md',
      '- [id]: ../../outside.md',
      '[multiline label\n]: ../../outside.md',
    ];

    for (const markdown of markdownSamples) {
      expect(() => markdownLinkTargets(markdown)).toThrowError('Unsupported Markdown link syntax');
    }
  });

  it('extracts a link whose label contains a matching backtick code span', () => {
    expect(markdownLinkTargets('[`code ] text`](../../outside.md)')).toEqual(['../../outside.md']);
  });

  it('fails closed when a Markdown resource starter has no recognized target', () => {
    expect(() => markdownLinkTargets('[broken](<unterminated.md)')).toThrowError(
      'Unsupported Markdown link syntax'
    );
    expect(() => markdownLinkTargets('[broken]:')).toThrowError('Unsupported Markdown link syntax');
  });

  it('keeps every repository-relative Markdown link inside the repository', async () => {
    const repositoryRealPath = await realpath(repositoryRoot);
    const documents: readonly MarkdownDocument[] = [
      { path: runbookPath, contents: runbook },
      { path: technicalReferencePath, contents: technicalReference },
    ];

    for (const document of documents) {
      for (const target of markdownLinkTargets(document.contents)) {
        if (target.startsWith('#') || target.startsWith('https:')) continue;

        const pathTarget = target.split('#', 1)[0];
        expect(pathTarget, `${document.path} contains an absolute link`).not.toSatisfy(
          (candidate: string) => isAbsolute(candidate) || /^[a-z][a-z0-9+.-]*:/iu.test(candidate)
        );

        const resolvedTarget = resolve(
          dirname(document.path),
          decodeURIComponent(pathTarget ?? '')
        );
        const repositoryRelativeTarget = relative(repositoryRoot, resolvedTarget);
        expect(
          repositoryRelativeTarget,
          `${document.path} contains a link outside the repository`
        ).not.toSatisfy(
          (candidate: string) => candidate === '..' || candidate.startsWith(`..${pathSeparator()}`)
        );

        const targetRealPath = await realpath(resolvedTarget);
        const realRepositoryRelativeTarget = relative(repositoryRealPath, targetRealPath);
        expect(
          realRepositoryRelativeTarget,
          `${document.path} resolves a link outside the repository`
        ).not.toSatisfy(
          (candidate: string) => candidate === '..' || candidate.startsWith(`..${pathSeparator()}`)
        );
        expect((await lstat(resolvedTarget)).isFile()).toBe(true);
      }
    }
  });
});

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return '';
    throw error;
  }
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function markdownLinkTargets(markdown: string): string[] {
  if (markdown.includes(']:')) throw new Error(UNSUPPORTED_MARKDOWN_LINK_SYNTAX);

  return inlineMarkdownTargetMatches(markdown).map(({ target }) => target);
}

function inlineMarkdownTargetMatches(
  markdown: string
): { readonly index: number; readonly target: string }[] {
  const matches: { index: number; target: string }[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    const labelOpen = inlineLabelOpenAt(markdown, index);
    if (labelOpen === undefined) continue;

    const labelClose = balancedLabelClose(markdown, labelOpen);
    if (labelClose === undefined || markdown[labelClose + 1] !== '(') {
      if (labelOpen !== index) index = labelOpen;
      continue;
    }
    const match = parseInlineMarkdownDestination(markdown, labelClose);
    if (match === undefined) throw new Error(UNSUPPORTED_MARKDOWN_LINK_SYNTAX);

    const labelContentsStart = labelOpen + 1;
    const nestedMatches = inlineMarkdownTargetMatches(
      markdown.slice(labelContentsStart, labelClose)
    ).map(({ index: nestedIndex, target }) => ({
      index: labelContentsStart + nestedIndex,
      target,
    }));
    matches.push(...nestedMatches, { index, target: match.target });
    index = match.closeIndex;
  }
  return matches;
}

function inlineLabelOpenAt(markdown: string, index: number): number | undefined {
  if (isBackslashEscaped(markdown, index)) return undefined;
  if (markdown[index] === '!' && markdown[index + 1] === '[') return index + 1;
  if (markdown[index] !== '[') return undefined;

  const previousIndex = index - 1;
  return previousIndex >= 0 &&
    markdown[previousIndex] === '!' &&
    !isBackslashEscaped(markdown, previousIndex)
    ? undefined
    : index;
}

function parseInlineMarkdownDestination(
  markdown: string,
  labelClose: number
): { readonly target: string; readonly closeIndex: number } | undefined {
  const destinationStart = skipMarkdownWhitespace(markdown, labelClose + 2);
  if (markdown[destinationStart] === '<') {
    const angleClose = unescapedAngleClose(markdown, destinationStart + 1);
    if (angleClose === undefined) return undefined;
    const linkClose = inlineLinkClose(markdown, angleClose + 1);
    return linkClose === undefined
      ? undefined
      : { target: markdown.slice(destinationStart + 1, angleClose), closeIndex: linkClose };
  }

  return parseBareInlineDestination(markdown, destinationStart);
}

function balancedLabelClose(markdown: string, labelOpen: number): number | undefined {
  let depth = 1;
  for (let index = labelOpen + 1; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
    } else if (markdown[index] === '`') {
      const codeSpanClose = matchingCodeSpanClose(markdown, index);
      if (codeSpanClose !== undefined) index = codeSpanClose;
    } else if (markdown[index] === '[') {
      depth += 1;
    } else if (markdown[index] === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function matchingCodeSpanClose(markdown: string, openingStart: number): number | undefined {
  const openingLength = backtickRunLength(markdown, openingStart);
  for (let index = openingStart + openingLength; index < markdown.length; ) {
    if (markdown[index] !== '`') {
      index += 1;
      continue;
    }

    const candidateLength = backtickRunLength(markdown, index);
    if (candidateLength === openingLength) return index + candidateLength - 1;
    index += candidateLength;
  }
  return undefined;
}

function backtickRunLength(markdown: string, start: number): number {
  let length = 0;
  while (markdown[start + length] === '`') length += 1;
  return length;
}

function unescapedAngleClose(markdown: string, targetStart: number): number | undefined {
  for (let index = targetStart; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
    } else if (markdown[index] === '>') {
      return index;
    } else if (markdown[index] === '\r' || markdown[index] === '\n') {
      return undefined;
    }
  }
  return undefined;
}

function parseBareInlineDestination(
  markdown: string,
  targetStart: number
): { readonly target: string; readonly closeIndex: number } | undefined {
  let depth = 0;
  for (let index = targetStart; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === '\\') {
      index += 1;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      if (depth > 0) {
        depth -= 1;
      } else {
        return { target: markdown.slice(targetStart, index), closeIndex: index };
      }
    } else if (isMarkdownWhitespace(character)) {
      if (depth !== 0) return undefined;
      const linkClose = inlineLinkClose(markdown, index);
      return linkClose === undefined
        ? undefined
        : { target: markdown.slice(targetStart, index), closeIndex: linkClose };
    }
  }
  return undefined;
}

function inlineLinkClose(markdown: string, start: number): number | undefined {
  let index = skipMarkdownWhitespace(markdown, start);
  if (markdown[index] === ')') return index;

  const titleOpen = markdown[index];
  const titleClose = titleOpen === '(' ? ')' : titleOpen;
  if (titleOpen !== '"' && titleOpen !== "'" && titleOpen !== '(') return undefined;

  for (index += 1; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
    } else if (markdown[index] === titleClose) {
      const closeIndex = skipMarkdownWhitespace(markdown, index + 1);
      return markdown[closeIndex] === ')' ? closeIndex : undefined;
    }
  }
  return undefined;
}

function skipMarkdownWhitespace(markdown: string, start: number): number {
  let index = start;
  while (isMarkdownWhitespace(markdown[index])) index += 1;
  return index;
}

function isMarkdownWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function isBackslashEscaped(markdown: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function pathSeparator(): '/' | '\\' {
  return process.platform === 'win32' ? '\\' : '/';
}
