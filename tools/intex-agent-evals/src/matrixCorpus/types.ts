import type {
  MatrixCorpusExpectedToolScheduleV1,
  StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import type { IntexEvalScenario } from '../scenarioSchema.js';

export type MatrixCorpusAgentModel = 'or:deepseek/deepseek-v4-flash';
export type MatrixCorpusEvaluatorModel = 'or:minimax/minimax-m3';

export interface CanonicalMatrixCorpusScenario {
  readonly scenario: IntexEvalScenario;
  readonly scenarioNumber: number;
  readonly scenarioLabel: string;
  readonly scenarioDigest: string;
  readonly mockProfile: StrictToolMockProfileV1;
  readonly mockProfileDigest: string;
  readonly expectedToolSchedule: MatrixCorpusExpectedToolScheduleV1;
}

export interface CanonicalMatrixCorpus {
  readonly agentModel: MatrixCorpusAgentModel;
  readonly evaluatorModel: MatrixCorpusEvaluatorModel;
  readonly scenarioCount: 20;
  readonly turnCount: 59;
  readonly catalogDigest: string;
  readonly scenarios: readonly CanonicalMatrixCorpusScenario[];
}
