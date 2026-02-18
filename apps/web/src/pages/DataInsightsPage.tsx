import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { DataInsightsTabs, Layout } from '@/components';
import { DataInsightCard } from '@/components/DataInsightCard.js';
import { ChartDefinitionDisplay } from '@/components/ChartDefinitionDisplay.js';
import { useDataInsights, useChartDefinition, useCreateVisualization } from '@/hooks';
import type { DataInsight } from '@/types';

export function DataInsightsPage(): React.JSX.Element {
  const { feedId } = useParams<{ feedId: string }>();
  const navigate = useNavigate();
  const [selectedInsight, setSelectedInsight] = useState<DataInsight | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => (): void => {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
  }, []);

  const { insights, noInsightsReason, analyzing, error: insightsError, analyzeData } = useDataInsights(
    feedId ?? '',
    null
  );
  const {
    chartDefinition,
    generating: chartGenerating,
    error: chartDefinitionError,
    generateDefinition,
    clearDefinition,
  } = useChartDefinition(feedId ?? '');
  const {
    creating: savingVisualization,
    error: saveError,
    createVisualization,
  } = useCreateVisualization();

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
      setSaveSuccess(false);
      void generateDefinition(insightId);
    }
  };

  const handleSaveVisualization = (): void => {
    if (chartDefinition === null || feedId === undefined) return;
    void (async (): Promise<void> => {
      const viz = await createVisualization({
        feedId,
        insightId: selectedInsight?.id ?? '',
        chartConfig: chartDefinition.vegaLiteConfig,
        transformInstructions: chartDefinition.dataTransformInstructions,
      });
      if (viz !== null) {
        setSaveSuccess(true);
        timeoutRef.current = setTimeout(() => {
          void navigate('/data-insights/visualizations');
        }, 1500);
      }
    })();
  };

  if (feedId === undefined || feedId === '') {
    return (
      <Layout>
        <DataInsightsTabs />
        <div className="flex items-center justify-center py-12">
          <AlertCircle className="mr-2 h-5 w-5 text-red-500 dark:text-red-400" />
          <span className="text-slate-700 dark:text-slate-300">Invalid feed ID</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <DataInsightsTabs />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Data Insights</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">Analyze your composite feed data and generate visualizations</p>
      </div>

      {analyzing && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">Analyzing your data...</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">This may take a moment</p>
        </div>
      )}

      {insightsError !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">Error analyzing data:</span>
            <span>{insightsError}</span>
          </div>
        </div>
      )}

      {!analyzing && insights !== null && (
        <>
          {insights.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800">
              <AlertCircle className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-700 dark:text-slate-200">No insights generated</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
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

              {chartDefinitionError !== null && selectedInsight !== null && (
                <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500 dark:text-red-400" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-400">
                        Failed to generate chart for: {selectedInsight.title}
                      </p>
                      <p className="mt-1 text-sm text-red-600 dark:text-red-300">{chartDefinitionError}</p>
                    </div>
                  </div>
                </div>
              )}

              {chartDefinition !== null && selectedInsight !== null && (
                <>
                  <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-700">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      Chart for: {selectedInsight.title}
                    </h2>
                    <ChartDefinitionDisplay
                      chartDefinition={chartDefinition}
                      onSave={handleSaveVisualization}
                      isSaving={savingVisualization}
                    />
                    {saveSuccess && (
                      <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
                        <CheckCircle className="h-5 w-5" />
                        <span>Visualization saved! Redirecting to visualizations...</span>
                      </div>
                    )}
                    {saveError !== null && (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                          <AlertCircle className="h-5 w-5" />
                          <span>Failed to save visualization: {saveError}</span>
                        </div>
                      </div>
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
