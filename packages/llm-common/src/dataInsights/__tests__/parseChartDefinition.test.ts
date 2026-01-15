import { describe, expect, it } from 'vitest';
import { parseChartDefinition } from '../parseChartDefinition.js';

describe('parseChartDefinition', () => {
  const validResponse = `
    CHART_CONFIG_START
    {
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "mark": "bar",
      "encoding": {
        "x": {"field": "category", "type": "nominal"},
        "y": {"field": "value", "type": "quantitative"}
      }
    }
    CHART_CONFIG_END

    TRANSFORM_INSTRUCTIONS_START
    Add title and adjust colors
    TRANSFORM_INSTRUCTIONS_END
  `;

  it('parses valid chart definition successfully', () => {
    const result = parseChartDefinition(validResponse);

    expect(result.vegaLiteConfig).toEqual({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    });
    expect(result.transformInstructions).toBe('Add title and adjust colors');
  });

  it('throws when CHART_CONFIG_START markers are missing', () => {
    const response = `
      TRANSFORM_INSTRUCTIONS_START
      Some instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Missing CHART_CONFIG_START...CHART_CONFIG_END markers'
    );
  });

  it('throws when TRANSFORM_INSTRUCTIONS_START markers are missing', () => {
    const response = `
      CHART_CONFIG_START
      {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "mark": "bar", "encoding": {}}
      CHART_CONFIG_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Missing TRANSFORM_INSTRUCTIONS_START...TRANSFORM_INSTRUCTIONS_END markers'
    );
  });

  it('throws when chart config is empty', () => {
    const response = `
      CHART_CONFIG_START

      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow('Chart config is empty');
  });

  it('throws when transform instructions are empty', () => {
    const response = `
      CHART_CONFIG_START
      {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "mark": "bar", "encoding": {}}
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START

      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow('Transform instructions are empty');
  });

  it('throws when chart config JSON is invalid', () => {
    const response = `
      CHART_CONFIG_START
      {"invalid": json}
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow('Invalid JSON in chart config');
  });

  it('throws when chart config is not an object', () => {
    const response = `
      CHART_CONFIG_START
      "just a string"
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow('Chart config must be an object');
  });

  it('throws when chart config includes data property', () => {
    const response = `
      CHART_CONFIG_START
      {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "mark": "bar",
        "encoding": {},
        "data": {"values": [1, 2, 3]}
      }
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Chart config must NOT include "data" property'
    );
  });

  it('throws when chart config missing $schema property', () => {
    const response = `
      CHART_CONFIG_START
      {
        "mark": "bar",
        "encoding": {}
      }
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Chart config must include "$schema" property'
    );
  });

  it('throws when chart config missing mark property', () => {
    const response = `
      CHART_CONFIG_START
      {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "encoding": {}
      }
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Chart config must include "mark" property'
    );
  });

  it('throws when chart config missing encoding property', () => {
    const response = `
      CHART_CONFIG_START
      {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "mark": "bar"
      }
      CHART_CONFIG_END

      TRANSFORM_INSTRUCTIONS_START
      Instructions
      TRANSFORM_INSTRUCTIONS_END
    `;

    expect(() => parseChartDefinition(response)).toThrow(
      'Chart config must include "encoding" property'
    );
  });

  it('handles extra whitespace in response', () => {
    const response = `
    CHART_CONFIG_START

    {
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "mark": "bar",
      "encoding": {
        "x": {"field": "category", "type": "nominal"}
      }
    }

    CHART_CONFIG_END

    TRANSFORM_INSTRUCTIONS_START

    Trim the data

    TRANSFORM_INSTRUCTIONS_END
    `;

    const result = parseChartDefinition(response);

    expect(result.transformInstructions).toBe('Trim the data');
    expect(result.vegaLiteConfig.mark).toBe('bar');
  });
});
