import { useEffect, useRef } from 'react';
import embed from 'vega-embed';
import { Card } from '@/components/ui/index.js';
import type { ChartDefinition } from '@/services/dataInsightsApi.js';

interface VegaChartProps {
  spec: object;
  data: object;
  onRenderError?: (error: Error) => void;
}

function VegaChart({ spec, data, onRenderError }: VegaChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const container = containerRef.current;

    embed(container, spec, {
      actions: false,
      renderer: 'canvas',
    })
      .then(() => {
        // Chart rendered successfully
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        onRenderError?.(err);
      });

    return (): void => {
      container.innerHTML = '';
    };
  }, [spec, data, onRenderError]);

  return <div ref={containerRef} className="w-full" />;
}

interface ChartPreviewProps {
  chartDefinition: ChartDefinition;
  chartData: object[];
  isLoading: boolean;
  error: string | null;
}

export function ChartPreview({ chartDefinition, chartData, isLoading, error }: ChartPreviewProps): React.JSX.Element {
  if (isLoading) {
    return (
      <Card className="mt-4 flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        <span className="ml-3 text-slate-600">Generating preview...</span>
      </Card>
    );
  }

  if (error !== null) {
    return (
      <Card className="mt-4 border-red-200 bg-red-50">
        <div className="flex items-center gap-2 text-red-700">
          <span className="font-medium">Error generating preview:</span>
          <span>{error}</span>
        </div>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="mt-4">
        <p className="text-slate-600">No data available for preview. Please try again.</p>
      </Card>
    );
  }

  const fullSpec = {
    ...chartDefinition.vegaLiteConfig,
    data: { values: chartData },
  };

  return (
    <Card className="mt-4">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Chart Preview</h3>
      <VegaChart spec={fullSpec} data={chartData} />
    </Card>
  );
}
