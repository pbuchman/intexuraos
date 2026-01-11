/**
 * Domain types for data visualizations.
 * Visualizations are LLM-generated HTML/JS content for rendering insights.
 */

export type VisualizationType = 'chart' | 'table' | 'summary' | 'custom';

export type VisualizationStatus = 'pending' | 'ready' | 'error';

/**
 * Visualization entity representing LLM-generated visual content.
 */
export interface Visualization {
  id: string;
  feedId: string;
  userId: string;
  title: string;
  description: string;
  type: VisualizationType;
  status: VisualizationStatus;
  htmlContent: string | null;
  errorMessage: string | null;
  renderErrorCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastGeneratedAt: Date | null;
}

/**
 * Request to create a new visualization.
 */
export interface CreateVisualizationRequest {
  title: string;
  description: string;
  type: VisualizationType;
}

/**
 * Request to generate visualization content via LLM.
 */
export interface GenerateVisualizationContentRequest {
  visualizationId: string;
  feedId: string;
  userId: string;
  title: string;
  description: string;
  type: VisualizationType;
}

/**
 * Result of LLM visualization generation.
 */
export interface GeneratedVisualizationContent {
  htmlContent: string;
}

/**
 * Service for generating visualization HTML content via LLM.
 */
export interface VisualizationGenerationService {
  generateContent(
    snapshotData: object,
    request: GenerateVisualizationContentRequest
  ): Promise<GeneratedVisualizationContent>;
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_RENDER_ERROR_COUNT = 10;
