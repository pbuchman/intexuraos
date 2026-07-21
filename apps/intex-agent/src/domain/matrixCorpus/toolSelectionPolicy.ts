import {
  intexAgentToolNameV1Schema,
  type IntexAgentToolNameV1,
} from '@intexuraos/http-contracts';

import type { DecodedStrictToolMockProfile } from './strictToolMockProfile.js';

export interface MatrixCorpusToolSelectionInput {
  profile: DecodedStrictToolMockProfile;
  turnIndex: number;
  toolName: unknown;
  ordinal: number;
  expectedByCatalog?: boolean;
}

export type MatrixCorpusToolSelectionDecision =
  | Readonly<{
      decision: 'allow';
      call: ReturnType<DecodedStrictToolMockProfile['findCall']> & object;
    }>
  | Readonly<{
      decision: 'behavioral_failure';
      code: 'FORBIDDEN_TOOL_SELECTED' | 'UNEXPECTED_KNOWN_TOOL_SELECTED';
      toolName: IntexAgentToolNameV1;
      turnIndex: number;
      ordinal: number;
    }>
  | Readonly<{
      decision: 'safety_stop';
      code: 'MISSING_EXPECTED_MOCK_CONFIGURATION' | 'TOOL_OUTSIDE_CLOSED_CATALOG';
      toolName: unknown;
      turnIndex: number;
      ordinal: number;
    }>;

type MatrixCorpusRejectedToolSelectionDecision = Exclude<
  MatrixCorpusToolSelectionDecision,
  Readonly<{ decision: 'allow' }>
>;

export function evaluateMatrixCorpusToolSelection(
  input: MatrixCorpusToolSelectionInput
): MatrixCorpusToolSelectionDecision {
  const parsedToolName = intexAgentToolNameV1Schema.safeParse(input.toolName);
  if (!parsedToolName.success) {
    return selectionResult(input, 'safety_stop', 'TOOL_OUTSIDE_CLOSED_CATALOG');
  }
  const toolName = parsedToolName.data;
  const call = input.profile.findCall({
    turnIndex: input.turnIndex,
    toolName,
    ordinal: input.ordinal,
  });
  if (call !== undefined) return { decision: 'allow', call };

  if (input.expectedByCatalog === true) {
    return selectionResult(
      { ...input, toolName },
      'safety_stop',
      'MISSING_EXPECTED_MOCK_CONFIGURATION'
    );
  }

  const forbidden = input.profile.profile.forbiddenSelections.some(
    (selection) =>
      selection.turnIndex === input.turnIndex && selection.toolName === toolName
  );
  return selectionResult(
    { ...input, toolName },
    'behavioral_failure',
    forbidden ? 'FORBIDDEN_TOOL_SELECTED' : 'UNEXPECTED_KNOWN_TOOL_SELECTED'
  );
}

function selectionResult<
  Decision extends 'behavioral_failure' | 'safety_stop',
>(
  input: Pick<MatrixCorpusToolSelectionInput, 'toolName' | 'turnIndex' | 'ordinal'>,
  decision: Decision,
  code: MatrixCorpusRejectedToolSelectionDecision['code']
): Extract<MatrixCorpusToolSelectionDecision, Readonly<{ decision: Decision }>> {
  return {
    decision,
    code,
    toolName: input.toolName,
    turnIndex: input.turnIndex,
    ordinal: input.ordinal,
  } as Extract<MatrixCorpusToolSelectionDecision, Readonly<{ decision: Decision }>>;
}
