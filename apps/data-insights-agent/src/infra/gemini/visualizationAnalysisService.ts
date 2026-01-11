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

/**
 * Create a visualization analysis service.
 */
export function createVisualizationAnalysisService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): VisualizationGenerationService {
  const pricing = pricingContext.getPricing(VISUALIZATION_MODEL);

  return {
    async generateContent(
      snapshotData: object,
      request: GenerateVisualizationContentRequest
    ): Promise<GeneratedVisualizationContent> {
      const keyResult = await userServiceClient.getGeminiApiKey(request.userId);

      if (!keyResult.ok) {
        const error = keyResult.error;
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

      const insightsPromptText = insightsPrompt.build({
        snapshotData,
        feedPurpose,
      });

      const insightsResult = await geminiClient.generate(insightsPromptText);

      if (!insightsResult.ok) {
        throw new Error(`Failed to generate insights: ${insightsResult.error.message}`);
      }

      const insights = insightsResult.value.content.trim();

      const vegaLitePromptText = vegaLitePrompt.build({
        snapshotData,
        feedPurpose,
        insights,
      });

      const vegaLiteResult = await geminiClient.generate(vegaLitePromptText);

      if (!vegaLiteResult.ok) {
        throw new Error(`Failed to generate Vega-Lite spec: ${vegaLiteResult.error.message}`);
      }

      const vegaLiteSpec = vegaLiteResult.value.content.trim();

      const htmlContent = generateHtmlContent(request.title, insights, vegaLiteSpec);

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
