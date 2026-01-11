/**
 * Data insights domain exports.
 */

export type { DataInsight, ChartTypeDefinition, ChartTypeId } from './types.js';
export { MAX_INSIGHTS_PER_FEED } from './types.js';
export { CHART_TYPES } from './chartTypes.js';

export {
  analyzeData,
  type AnalyzeDataDeps,
  type AnalyzeDataError,
  type AnalyzeDataResult,
} from './usecases/analyzeData.js';
