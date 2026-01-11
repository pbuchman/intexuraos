/**
 * Visualization analysis service using Gemini.
 * Generates insights and Vega-Lite visualizations from feed snapshot data.
 */

import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { insightsPrompt, vegaLitePrompt } from '@intexuraos/llm-common';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  VisualizationGenerationService,
  GenerateVisualizationContentRequest,
  GeneratedVisualizationContent,
} from '../../domain/visualization/index.js';

const VISUALIZATION_MODEL: FastModel = LlmModels.Gemini25Flash;

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Create a visualization analysis service.
 */
export function createVisualizationAnalysisService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext,
  logger?: BasicLogger
): VisualizationGenerationService {
  const pricing = pricingContext.getPricing(VISUALIZATION_MODEL);

  return {
    async generateContent(
      snapshotData: object,
      request: GenerateVisualizationContentRequest
    ): Promise<GeneratedVisualizationContent> {
      const { visualizationId, feedId, userId } = request;

      logger?.info({ visualizationId, feedId, userId }, 'Starting visualization generation');

      // Fetch API key
      logger?.info({ userId }, 'Fetching Gemini API key');
      const keyResult = await userServiceClient.getGeminiApiKey(request.userId);

      if (!keyResult.ok) {
        const error = keyResult.error;
        logger?.error({ userId, errorCode: error.code }, 'Failed to fetch Gemini API key');
        if (error.code === 'NO_API_KEY') {
          throw new Error('Please configure your Gemini API key in settings first');
        }
        throw new Error(`User service error: ${error.message}`);
      }

      const apiKey = keyResult.value;
      const geminiClient = createGeminiClient({
        apiKey,
        model: VISUALIZATION_MODEL,
        userId: request.userId,
        pricing,
      });

      const feedPurpose = request.description;
      const dataStr = JSON.stringify(snapshotData);
      const dataSize = dataStr.length;
      const dataTruncated = dataSize > 100000;

      logger?.info(
        { visualizationId, dataSize, dataTruncated },
        'Prepared snapshot data for LLM'
      );

      // Generate insights
      const insightsPromptText = insightsPrompt.build({
        snapshotData,
        feedPurpose,
      });

      logger?.info(
        { visualizationId, promptLength: insightsPromptText.length },
        'Starting insights generation'
      );

      const insightsStartTime = Date.now();
      const insightsResult = await geminiClient.generate(insightsPromptText);
      const insightsDuration = Date.now() - insightsStartTime;

      if (!insightsResult.ok) {
        logger?.error(
          { visualizationId, error: insightsResult.error.message },
          'Insights generation failed'
        );
        throw new Error(`Failed to generate insights: ${insightsResult.error.message}`);
      }

      const insights = insightsResult.value.content.trim();
      const insightsUsage = insightsResult.value.usage;

      logger?.info(
        {
          visualizationId,
          durationMs: insightsDuration,
          insightsLength: insights.length,
          inputTokens: insightsUsage.inputTokens,
          outputTokens: insightsUsage.outputTokens,
          costUsd: insightsUsage.costUsd,
          insightsPreview: insights.slice(0, 150),
        },
        'Insights generated successfully'
      );

      // Generate Vega-Lite spec
      const vegaLitePromptText = vegaLitePrompt.build({
        snapshotData,
        feedPurpose,
        insights,
      });

      logger?.info(
        { visualizationId, promptLength: vegaLitePromptText.length, insightsLength: insights.length },
        'Starting Vega-Lite spec generation'
      );

      const vegaLiteStartTime = Date.now();
      const vegaLiteResult = await geminiClient.generate(vegaLitePromptText);
      const vegaLiteDuration = Date.now() - vegaLiteStartTime;

      if (!vegaLiteResult.ok) {
        logger?.error(
          { visualizationId, error: vegaLiteResult.error.message },
          'Vega-Lite spec generation failed'
        );
        throw new Error(`Failed to generate Vega-Lite spec: ${vegaLiteResult.error.message}`);
      }

      const vegaLiteSpecRaw = vegaLiteResult.value.content.trim();
      const vegaLiteUsage = vegaLiteResult.value.usage;

      logger?.info(
        {
          visualizationId,
          durationMs: vegaLiteDuration,
          specLength: vegaLiteSpecRaw.length,
          inputTokens: vegaLiteUsage.inputTokens,
          outputTokens: vegaLiteUsage.outputTokens,
          costUsd: vegaLiteUsage.costUsd,
        },
        'Vega-Lite spec generated successfully'
      );

      // Validate and sanitize the Vega-Lite spec to prevent XSS
      logger?.info({ visualizationId }, 'Sanitizing and validating Vega-Lite spec');

      let vegaLiteSpec: string;
      try {
        vegaLiteSpec = sanitizeVegaLiteSpec(vegaLiteSpecRaw);

        // Extract chart type for logging
        const parsedSpec = JSON.parse(vegaLiteSpec) as { mark?: unknown; layer?: unknown };
        const chartType = parsedSpec.mark !== undefined
          ? typeof parsedSpec.mark === 'string'
            ? parsedSpec.mark
            : 'complex-mark'
          : parsedSpec.layer !== undefined
            ? 'layer'
            : 'unknown';

        logger?.info(
          { visualizationId, chartType, specSize: vegaLiteSpec.length },
          'Spec sanitization successful'
        );
      } catch (error) {
        logger?.error(
          { visualizationId, error, rawSpecPreview: vegaLiteSpecRaw.slice(0, 200) },
          'Spec sanitization failed'
        );
        throw error;
      }

      // Generate final HTML
      const htmlContent = generateHtmlContent(request.title, insights, vegaLiteSpec);

      const totalCost = insightsUsage.costUsd + vegaLiteUsage.costUsd;
      const totalTokens = insightsUsage.totalTokens + vegaLiteUsage.totalTokens;
      const totalDuration = insightsDuration + vegaLiteDuration;

      logger?.info(
        {
          visualizationId,
          htmlSize: htmlContent.length,
          totalDurationMs: totalDuration,
          totalTokens,
          totalCostUsd: totalCost,
        },
        'Visualization generation completed successfully'
      );

      return { htmlContent };
    },
  };
}

/**
 * Generate HTML content that includes insights and Vega-Lite visualization.
 */
function generateHtmlContent(title: string, insights: string, vegaLiteSpec: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      margin: 0 0 20px 0;
      color: #333;
      font-size: 24px;
    }
    .insights {
      margin-bottom: 30px;
      padding: 15px;
      background: #f9f9f9;
      border-left: 4px solid #4CAF50;
      border-radius: 4px;
    }
    .insights h2 {
      margin: 0 0 10px 0;
      font-size: 18px;
      color: #333;
    }
    .insights p {
      margin: 0;
      color: #666;
      line-height: 1.6;
      white-space: pre-line;
    }
    #vis {
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <div class="insights">
      <h2>Key Insights</h2>
      <p>${escapeHtml(insights)}</p>
    </div>
    <div id="vis"></div>
  </div>
  <script type="text/javascript">
    const spec = ${vegaLiteSpec};
    vegaEmbed('#vis', spec, {actions: {export: true, source: false, editor: false}})
      .catch(console.error);
  </script>
</body>
</html>`;
}

/**
 * Sanitize and validate Vega-Lite spec from LLM response.
 * - Strips markdown code fences
 * - Validates JSON structure
 * - Validates basic Vega-Lite schema requirements
 * - Re-serializes to prevent XSS code injection
 */
function sanitizeVegaLiteSpec(rawSpec: string): string {
  let spec = rawSpec.trim();

  // Strip markdown code fences if LLM wrapped the response
  if (spec.startsWith('```')) {
    spec = spec.replace(/^```(?:json|vega-lite)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(spec);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for Vega-Lite spec. Response started with: "${spec.slice(0, 100)}..."`
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM returned non-object value for Vega-Lite spec');
  }

  const vegaSpec = parsed as Record<string, unknown>;

  // Validate required Vega-Lite properties
  if (!('mark' in vegaSpec) && !('layer' in vegaSpec) && !('concat' in vegaSpec) && !('hconcat' in vegaSpec) && !('vconcat' in vegaSpec)) {
    throw new Error(
      'Invalid Vega-Lite spec: missing required property (mark, layer, concat, hconcat, or vconcat)'
    );
  }

  return JSON.stringify(vegaSpec);
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
}
