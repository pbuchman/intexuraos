/**
 * Chart type definitions with Vega-Lite schemas.
 */

import type { ChartTypeDefinition } from './types.js';

/**
 * Supported chart types with their Vega-Lite schema templates.
 */
export const CHART_TYPES: ChartTypeDefinition[] = [
  {
    id: 'C1',
    name: 'Line Chart',
    mark: 'line',
    bestFor: 'Time-series trends and continuous data progression',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'line',
      encoding: {
        x: {
          field: '',
          type: 'temporal',
          title: '',
        },
        y: {
          field: '',
          type: 'quantitative',
          title: '',
        },
      },
    },
  },
  {
    id: 'C2',
    name: 'Bar Chart',
    mark: 'bar',
    bestFor: 'Category comparison and discrete value analysis',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'bar',
      encoding: {
        x: {
          field: '',
          type: 'nominal',
          title: '',
        },
        y: {
          field: '',
          type: 'quantitative',
          title: '',
        },
      },
    },
  },
  {
    id: 'C3',
    name: 'Scatter Plot',
    mark: 'point',
    bestFor: 'Correlation analysis and relationship patterns',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'point',
      encoding: {
        x: {
          field: '',
          type: 'quantitative',
          title: '',
        },
        y: {
          field: '',
          type: 'quantitative',
          title: '',
        },
      },
    },
  },
  {
    id: 'C4',
    name: 'Area Chart',
    mark: 'area',
    bestFor: 'Cumulative trends and volume over time',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'area',
      encoding: {
        x: {
          field: '',
          type: 'temporal',
          title: '',
        },
        y: {
          field: '',
          type: 'quantitative',
          title: '',
        },
      },
    },
  },
  {
    id: 'C5',
    name: 'Pie Chart',
    mark: 'arc',
    bestFor: 'Part-to-whole composition and percentage breakdown',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'arc',
      encoding: {
        theta: {
          field: '',
          type: 'quantitative',
        },
        color: {
          field: '',
          type: 'nominal',
        },
      },
    },
  },
  {
    id: 'C6',
    name: 'Heatmap',
    mark: 'rect',
    bestFor: 'Density patterns and matrix data visualization',
    vegaLiteSchema: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'rect',
      encoding: {
        x: {
          field: '',
          type: 'nominal',
          title: '',
        },
        y: {
          field: '',
          type: 'nominal',
          title: '',
        },
        color: {
          field: '',
          type: 'quantitative',
        },
      },
    },
  },
];
