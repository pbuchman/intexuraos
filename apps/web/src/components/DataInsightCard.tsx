import { BarChart3, TrendingUp, Eye } from 'lucide-react';
import { Button, Card } from '@/components/ui/index.js';
import type { DataInsight } from '@/types';

interface DataInsightCardProps {
  insight: DataInsight;
  onConfigureChart: (insightId: string) => void;
  isConfiguring: boolean;
}

const CHART_TYPE_NAMES: Record<string, string> = {
  C1: 'Line Chart',
  C2: 'Bar Chart',
  C3: 'Scatter Plot',
  C4: 'Area Chart',
  C5: 'Pie Chart',
  C6: 'Heatmap',
};

export function DataInsightCard({ insight, onConfigureChart, isConfiguring }: DataInsightCardProps): React.JSX.Element {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{insight.title}</h3>
            <span className="text-xs text-slate-500">{CHART_TYPE_NAMES[insight.suggestedChartType]}</span>
          </div>
        </div>
        <span className="text-xs text-slate-400">
          {new Date(insight.generatedAt).toLocaleDateString()}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600">{insight.description}</p>
      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-600">Trackable metric:</span>
        </div>
        <p className="mt-1 text-xs text-slate-600">{insight.trackableMetric}</p>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            onConfigureChart(insight.id);
          }}
          isLoading={isConfiguring}
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Configure Chart
        </Button>
      </div>
    </Card>
  );
}
