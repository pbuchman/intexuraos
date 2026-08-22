import type {
  MatrixCorpusAgentModel,
  MatrixCorpusEvaluatorModel,
  MatrixCorpusExpectedToolScheduleV1,
  StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import type { IntexEvalScenario } from '../scenarioSchema.js';

export type { MatrixCorpusAgentModel, MatrixCorpusEvaluatorModel };

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
  readonly turnCount: 60;
  readonly catalogDigest: string;
  readonly scenarios: readonly CanonicalMatrixCorpusScenario[];
}
