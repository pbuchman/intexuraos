import { Copy, Check, Save } from 'lucide-react';
import { Button, Card } from '@/components/ui/index.js';
import type { ChartDefinition } from '@/services/dataInsightsApi.js';
import { useState } from 'react';

interface ChartDefinitionDisplayProps {
  chartDefinition: ChartDefinition;
  onSave: () => void;
  isSaving: boolean;
}

export function ChartDefinitionDisplay({
  chartDefinition,
  onSave,
  isSaving,
}: ChartDefinitionDisplayProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(JSON.stringify(chartDefinition.vegaLiteConfig, null, 2));
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Chart Configuration</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => {
            void handleCopy();
          }}>
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5 text-green-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy Config
              </>
            )}
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} isLoading={isSaving}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save Visualization
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Vega-Lite Configuration</h4>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(chartDefinition.vegaLiteConfig, null, 2)}
        </pre>
      </div>
      <div className="mt-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Data Transform Instructions</h4>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {chartDefinition.dataTransformInstructions}
        </pre>
      </div>
    </Card>
  );
}
