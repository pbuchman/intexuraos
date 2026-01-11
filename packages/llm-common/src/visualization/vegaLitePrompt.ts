/**
 * Vega-Lite specification generation prompt.
 * Converts feed snapshot data into a valid Vega-Lite visualization specification.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface VegaLitePromptInput {
  /** The feed snapshot data to visualize */
  snapshotData: object;
  /** The feed purpose/description for context */
  feedPurpose: string;
  /** The insights generated for this data */
  insights: string;
}

export interface VegaLitePromptDeps extends PromptDeps {
  /** Maximum data size to process (default: 100000) */
  maxDataSize?: number;
}

export const vegaLitePrompt: PromptBuilder<VegaLitePromptInput, VegaLitePromptDeps> = {
  name: 'visualization-vegalite',
  description: 'Generates Vega-Lite specifications from feed snapshot data',

  build(input: VegaLitePromptInput, deps?: VegaLitePromptDeps): string {
    const maxDataSize = deps?.maxDataSize ?? 100000;
    const dataStr = JSON.stringify(input.snapshotData, null, 2);
    const truncatedData =
      dataStr.length > maxDataSize ? dataStr.slice(0, maxDataSize) + '...' : dataStr;

    return `You are a Vega-Lite visualization expert. Create a valid Vega-Lite specification for the provided data.

FEED PURPOSE:
${input.feedPurpose}

INSIGHTS:
${input.insights}

YOUR TASK:
Create a Vega-Lite specification that:
1. Best represents the data based on the insights
2. Is clear and readable
3. Uses appropriate chart type (bar, line, area, scatter, etc.)
4. Includes proper axes, labels, and legend
5. Uses appropriate color scheme
6. Is responsive and works well in web contexts

REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations)
- Use Vega-Lite version 5 syntax
- Include the data inline (do NOT use URLs)
- Use the $schema property: "https://vega.github.io/schema/vega-lite/v5.json"
- Keep it simple and focused on the key insights
- Ensure the spec is complete and renderable
- Use appropriate width/height (width: "container" is recommended)

FEED DATA:
${truncatedData}

Generate Vega-Lite specification:`;
  },
};
