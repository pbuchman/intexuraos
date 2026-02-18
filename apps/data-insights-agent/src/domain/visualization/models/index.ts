/**
 * Visualization domain models.
 */

export type VisualizationStatus = 'pending' | 'ready' | 'refreshing' | 'error';

export interface Visualization {
  id: string;
  userId: string;
  feedId: string;
  feedName: string;
  insightId: string;
  insightTitle: string;
  trackableMetric: string;
  chartConfig: object;
  transformInstructions: string;
  chartData: unknown[] | null;
  status: VisualizationStatus;
  lastError?: string;
  lastRefreshedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const MAX_VISUALIZATIONS_PER_FEED = 10;
