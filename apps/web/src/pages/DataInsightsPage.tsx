import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { Layout } from '@/components';
import { DataInsightCard } from '@/components/DataInsightCard.js';
import { ChartDefinitionDisplay } from '@/components/ChartDefinitionDisplay.js';
import { ChartPreview } from '@/components/ChartPreview.js';
import { useDataInsights, useChartDefinition, useChartPreview } from '@/hooks';
import type { DataInsight } from '@/types';
import type { PreviewChartRequest } from '@/services/dataInsightsApi.js';

export function DataInsightsPage(): React.JSX.Element {
  const { feedId } = useParams<{ feedId: string }>();
  const [selectedInsight, setSelectedInsight] = useState<DataInsight | null>(null);

  const { insights, noInsightsReason, analyzing, error: insightsError, analyzeData } = useDataInsights(
    feedId ?? '',
    null
  );
  const {
    chartDefinition,
    generating: chartGenerating,
    generateDefinition,
    clearDefinition,
  } = useChartDefinition(feedId ?? '');
  const {
    chartData,
    previewing,
    error: previewError,
    generatePreview,
    clearPreview,
  } = useChartPreview(feedId ?? '');

  useEffect(() => {
    if (feedId !== undefined && feedId !== '') {
      void analyzeData();
    }
  }, [feedId, analyzeData]);

  const handleConfigureChart = (insightId: string): void => {
    const insight = insights?.find((i) => i.id === insightId);
    if (insight !== undefined) {
      setSelectedInsight(insight);
      clearDefinition();
      clearPreview();
      void generateDefinition(insightId);
    }
  };

  const handlePreview = (): void => {
    if (chartDefinition !== null && selectedInsight !== null) {
      const request: PreviewChartRequest = {
        chartConfig: chartDefinition.vegaLiteConfig,
        transformInstructions: chartDefinition.dataTransformInstructions,
        insightId: selectedInsight.id,
      };
      void generatePreview(request);
    }
  };

  if (feedId === undefined || feedId === '') {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <AlertCircle className="mr-2 h-5 w-5 text-red-500" />
          <span className="text-slate-700">Invalid feed ID</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Data Insights</h1>
        <p className="mt-1 text-slate-600">Analyze your composite feed data and generate visualizations</p>
      </div>

      {analyzing && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="mt-4 text-lg text-slate-600">Analyzing your data...</p>
          <p className="mt-1 text-sm text-slate-500">This may take a moment</p>
        </div>
      )}

      {insightsError !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">Error analyzing data:</span>
            <span>{insightsError}</span>
          </div>
        </div>
      )}

      {!analyzing && insights !== null && (
        <>
          {insights.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-slate-400" />
              <p className="mt-4 text-lg font-medium text-slate-700">No insights generated</p>
              <p className="mt-1 text-sm text-slate-500">
                {noInsightsReason ?? 'Unable to generate insights from the current data structure.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                {insights.map((insight) => (
                  <DataInsightCard
                    key={insight.id}
                    insight={insight}
                    onConfigureChart={handleConfigureChart}
                    isConfiguring={chartGenerating && selectedInsight?.id === insight.id}
                  />
                ))}
              </div>

              {chartDefinition !== null && selectedInsight !== null && (
                <>
                  <div className="mt-6 border-t border-slate-200 pt-6">
                    <h2 className="text-xl font-semibold text-slate-900">
                      Chart for: {selectedInsight.title}
                    </h2>
                    <ChartDefinitionDisplay
                      chartDefinition={chartDefinition}
                      onPreview={handlePreview}
                      isPreviewing={previewing}
                    />
                    {(previewing || chartData !== null || previewError !== null) && (
                      <ChartPreview
                        chartDefinition={chartDefinition}
                        chartData={(chartData ?? []) as object[]}
                        isLoading={previewing}
                        error={previewError}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Layout>
  );
}
