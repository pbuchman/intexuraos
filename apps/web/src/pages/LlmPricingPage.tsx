import { useCallback, useEffect, useState } from 'react';
import { DollarSign, RefreshCw } from 'lucide-react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { getLlmPricing } from '@/services/settingsApi';
import type { AllProvidersPricing, LlmProvider, ModelPricing, ProviderPricing } from '@/types';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(price: number): string {
  if (price === 0) return '$0.00';
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

const PROVIDER_CONFIG: Record<LlmProvider, { name: string; color: string; bgColor: string }> = {
  google: { name: 'Google', color: 'text-blue-700', bgColor: 'bg-blue-50' },
  openai: { name: 'OpenAI', color: 'text-green-700', bgColor: 'bg-green-50' },
  anthropic: { name: 'Anthropic', color: 'text-orange-700', bgColor: 'bg-orange-50' },
  perplexity: { name: 'Perplexity', color: 'text-purple-700', bgColor: 'bg-purple-50' },
};

interface ModelRowProps {
  modelId: string;
  pricing: ModelPricing;
}

function ModelRow({ modelId, pricing }: ModelRowProps): React.JSX.Element {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h4 className="font-mono text-sm font-medium text-slate-900">{modelId}</h4>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Input:</span>
              <span className="font-medium text-slate-700">
                {formatPrice(pricing.inputPricePerMillion)}/M
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Output:</span>
              <span className="font-medium text-slate-700">
                {formatPrice(pricing.outputPricePerMillion)}/M
              </span>
            </div>
            {pricing.cacheReadMultiplier !== undefined ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Cache Read:</span>
                <span className="font-medium text-slate-700">{pricing.cacheReadMultiplier}x</span>
              </div>
            ) : null}
            {pricing.cacheWriteMultiplier !== undefined ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Cache Write:</span>
                <span className="font-medium text-slate-700">{pricing.cacheWriteMultiplier}x</span>
              </div>
            ) : null}
            {pricing.webSearchCostPerCall !== undefined ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Web Search:</span>
                <span className="font-medium text-slate-700">
                  {formatPrice(pricing.webSearchCostPerCall)}/call
                </span>
              </div>
            ) : null}
            {pricing.groundingCostPerRequest !== undefined ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Grounding:</span>
                <span className="font-medium text-slate-700">
                  {formatPrice(pricing.groundingCostPerRequest)}/req
                </span>
              </div>
            ) : null}
          </div>
          {pricing.imagePricing !== undefined ? (
            <div className="mt-2 text-xs">
              <span className="text-slate-500">Images: </span>
              {Object.entries(pricing.imagePricing).map(([size, price], idx) => (
                <span key={size} className="text-slate-700">
                  {idx > 0 ? ', ' : ''}
                  {size}: {formatPrice(price)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ProviderBlockProps {
  provider: LlmProvider;
  pricing: ProviderPricing;
}

function ProviderBlock({ provider, pricing }: ProviderBlockProps): React.JSX.Element {
  const config = PROVIDER_CONFIG[provider];
  const modelCount = Object.keys(pricing.models).length;

  return (
    <Card>
      <div className={`-m-4 mb-4 rounded-t-xl ${config.bgColor} px-4 py-3`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-lg font-semibold ${config.color}`}>{config.name}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
            {modelCount} {modelCount === 1 ? 'model' : 'models'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Updated: {formatDate(pricing.updatedAt)}</p>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {Object.entries(pricing.models)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelId, modelPricing]) => (
            <ModelRow key={modelId} modelId={modelId} pricing={modelPricing} />
          ))}
      </div>
    </Card>
  );
}

export function LlmPricingPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [pricing, setPricing] = useState<AllProvidersPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPricing = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getLlmPricing(token);
      setPricing(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load pricing'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchPricing();
  }, [fetchPricing]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">LLM Pricing</h2>
          <p className="text-slate-600">View current pricing for all LLM providers.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={(): void => {
            void fetchPricing();
          }}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : pricing === null ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <DollarSign className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No pricing data</h3>
            <p className="text-slate-500">Pricing data is not available.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <ProviderBlock provider="google" pricing={pricing.google} />
          <ProviderBlock provider="openai" pricing={pricing.openai} />
          <ProviderBlock provider="anthropic" pricing={pricing.anthropic} />
          <ProviderBlock provider="perplexity" pricing={pricing.perplexity} />
        </div>
      )}
    </Layout>
  );
}
