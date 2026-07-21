import { createHash } from 'node:crypto';
import {
  MATRIX_CORPUS_MAX_HEADER_CODE_UNITS,
  MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS,
  MATRIX_CORPUS_SCENARIO_TOTAL,
  matrixCorpusPromptDigestInputSchema,
  matrixCorpusVisibleConfirmationHeaderV1Schema,
  matrixCorpusVisibleStartHeaderV1Schema,
  matrixCorpusVisibleTurnHeaderV1Schema,
  type MatrixCorpusReservedHeaderReason,
  type MatrixCorpusVisibleMessageParseResult,
} from '@intexuraos/http-contracts';

const START_RESERVED_PREFIX = 'new session: 🧪 Scenario ';
const RESERVED_PREFIX = '🧪 Scenario ';
const separators = ['\r\n\r\n', '\n\n', '\r\r'] as const;
const corpusLookalikePrefix =
  /^(?:new session: )?\p{Extended_Pictographic} scenario \d+\/\d+\s*·\s*/iu;
const corpusLookalikeMarker = /\b(?:matrix corpus|step|confirmation|tools)\b|\bimc\d+_/iu;

function reservedMalformed(
  reason: MatrixCorpusReservedHeaderReason
): MatrixCorpusVisibleMessageParseResult {
  return { kind: 'reserved_malformed', reason };
}

function isCorpusHeaderLookalike(text: string): boolean {
  const lineBreakIndex = text.search(/[\r\n]/u);
  const firstHeaderLine =
    lineBreakIndex === -1 ? text : text.slice(0, lineBreakIndex);
  const prefix = corpusLookalikePrefix.exec(firstHeaderLine);
  if (prefix === null) {
    return false;
  }
  return corpusLookalikeMarker.test(firstHeaderLine.slice(prefix[0].length));
}

function splitHeaderAndBody(text: string): { header: string; body: string } | null {
  let separatorIndex = -1;
  let separator = '';
  for (const candidate of separators) {
    const index = text.indexOf(candidate);
    if (index !== -1 && (separatorIndex === -1 || index < separatorIndex)) {
      separatorIndex = index;
      separator = candidate;
    }
  }
  if (separatorIndex === -1) {
    return null;
  }
  return {
    header: text.slice(0, separatorIndex),
    body: text.slice(separatorIndex + separator.length),
  };
}

export function parseMatrixCorpusVisibleMessage(
  text: string
): MatrixCorpusVisibleMessageParseResult {
  const isReserved =
    text.startsWith(START_RESERVED_PREFIX) ||
    text.startsWith(RESERVED_PREFIX) ||
    isCorpusHeaderLookalike(text);
  if (!isReserved) {
    return { kind: 'ordinary' };
  }
  if (text.length > MATRIX_CORPUS_MAX_VISIBLE_MESSAGE_CODE_UNITS) {
    return reservedMalformed('message_too_large');
  }

  const split = splitHeaderAndBody(text);
  if (split === null) {
    return reservedMalformed('malformed_header');
  }
  if (split.header.length > MATRIX_CORPUS_MAX_HEADER_CODE_UNITS) {
    return reservedMalformed('header_too_large');
  }
  if (split.body.length === 0) {
    return reservedMalformed('empty_body');
  }
  if (separators.some((separator) => split.body.startsWith(separator))) {
    return reservedMalformed('malformed_header');
  }
  const start = /^new session: 🧪 Scenario (\d{3})\/020 · Matrix corpus · tools mocked · (imc1_[A-Za-z0-9_-]{43})$/.exec(split.header);
  if (start !== null) {
    const scenarioNumber = Number(start[1]);
    const capability = start[2];
    if (scenarioNumber < 1 || scenarioNumber > MATRIX_CORPUS_SCENARIO_TOTAL || capability === undefined) {
      return reservedMalformed('malformed_header');
    }
    return matrixCorpusVisibleStartHeaderV1Schema.parse({
      kind: 'matrix_corpus', version: 1, phase: 'start', scenarioNumber, scenarioTotal: 20,
      capability, naturalBody: split.body, textAfterHeaderRemoval: `new session: ${split.body}`,
      startNewSession: true,
    });
  }

  const turn = /^🧪 Scenario (\d{3})\/020 · step ([1-9]\d*)\/([1-9]\d*) · (imc1_[A-Za-z0-9_-]{43})$/.exec(split.header);
  if (turn !== null) {
    const scenarioNumber = Number(turn[1]);
    const turnIndex = Number(turn[2]);
    const turnTotal = Number(turn[3]);
    const capability = turn[4];
    if (
      scenarioNumber < 1 || scenarioNumber > MATRIX_CORPUS_SCENARIO_TOTAL ||
      turnIndex < 1 || turnIndex > turnTotal || turnTotal > MATRIX_CORPUS_SCENARIO_TOTAL ||
      capability === undefined
    ) {
      return reservedMalformed('malformed_header');
    }
    return matrixCorpusVisibleTurnHeaderV1Schema.parse({
      kind: 'matrix_corpus', version: 1, phase: 'turn', scenarioNumber, scenarioTotal: 20,
      turnIndex, turnTotal, capability, naturalBody: split.body, textAfterHeaderRemoval: split.body,
      startNewSession: false,
    });
  }

  const confirmation = /^🧪 Scenario (\d{3})\/020 · confirmation · (imc1_[A-Za-z0-9_-]{43})$/.exec(split.header);
  if (confirmation !== null) {
    const scenarioNumber = Number(confirmation[1]);
    const capability = confirmation[2];
    if (scenarioNumber < 1 || scenarioNumber > MATRIX_CORPUS_SCENARIO_TOTAL || capability === undefined) {
      return reservedMalformed('malformed_header');
    }
    return matrixCorpusVisibleConfirmationHeaderV1Schema.parse({
      kind: 'matrix_corpus', version: 1, phase: 'confirmation', scenarioNumber, scenarioTotal: 20,
      turnIndex: null, turnTotal: null, capability, naturalBody: split.body,
      textAfterHeaderRemoval: split.body, startNewSession: false,
    });
  }

  return reservedMalformed('malformed_header');
}

export function normalizeMatrixCorpusPromptV1(naturalBody: string): string {
  return naturalBody.replace(/\r\n|\r/g, '\n').normalize('NFC');
}

export function digestMatrixCorpusPromptV1(input: {
  body: string;
  startNewSession: boolean;
}): string {
  const parsed = matrixCorpusPromptDigestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid Matrix corpus prompt digest input');
  }
  const canonical = JSON.stringify({
    version: 1,
    body: normalizeMatrixCorpusPromptV1(parsed.data.body),
    startNewSession: parsed.data.startNewSession,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
