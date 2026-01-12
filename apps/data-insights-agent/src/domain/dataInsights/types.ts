/**
 * Data insights domain types.
 */

/**
 * Chart type identifiers for the 6 supported visualization types.
 */
export type ChartTypeId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';

/**
 * A single data insight generated from composite feed analysis.
 */
export interface DataInsight {
  id: string;
  title: string;
  description: string;
  trackableMetric: string;
  suggestedChartType: ChartTypeId;
  generatedAt: string;
}

/**
 * Definition of a chart type with Vega-Lite schema.
 */
export interface ChartTypeDefinition {
  id: ChartTypeId;
  name: string;
  mark: 'line' | 'bar' | 'point' | 'area' | 'arc' | 'rect';
  bestFor: string;
  vegaLiteSchema: object;
}

/**
 * Maximum number of insights to generate per feed.
 */
export const MAX_INSIGHTS_PER_FEED = 5;
