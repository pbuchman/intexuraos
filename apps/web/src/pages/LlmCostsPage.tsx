import { RefreshCw, TrendingUp, DollarSign, Zap, BarChart3 } from 'lucide-react';
import { Card, Layout } from '@/components';
import { useUsageCosts } from '@/hooks/useUsageCosts';
import { formatMonth } from '@/utils/dateFormat';
import type { MonthlyCost, ModelCost, CallTypeCost } from '@/types';

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

interface ProgressBarProps {
  percentage: number;
  color?: string;
}

function getWidthClass(percentage: number): string {
  const pct = Math.min(Math.round(percentage), 100);
  if (pct <= 0) return 'w-0';
  if (pct <= 5) return 'w-[5%]';
  if (pct <= 10) return 'w-[10%]';
  if (pct <= 15) return 'w-[15%]';
  if (pct <= 20) return 'w-1/5';
  if (pct <= 25) return 'w-1/4';
  if (pct <= 30) return 'w-[30%]';
  if (pct <= 33) return 'w-1/3';
  if (pct <= 40) return 'w-2/5';
  if (pct <= 50) return 'w-1/2';
  if (pct <= 60) return 'w-3/5';
  if (pct <= 66) return 'w-2/3';
  if (pct <= 75) return 'w-3/4';
  if (pct <= 80) return 'w-4/5';
  if (pct <= 90) return 'w-[90%]';
  if (pct < 100) return 'w-[95%]';
  return 'w-full';
}

function ProgressBar({ percentage, color = 'bg-blue-500' }: ProgressBarProps): React.JSX.Element {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${color} ${getWidthClass(percentage)}`} />
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}

function SummaryCard({ title, value, icon, subtitle }: SummaryCardProps): React.JSX.Element {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-blue-50 p-3">{icon}</div>
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          {subtitle !== undefined && subtitle !== '' ? (
            <p className="text-xs text-slate-400">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

interface MonthlyBreakdownProps {
  data: MonthlyCost[];
}

function MonthlyBreakdown({ data }: MonthlyBreakdownProps): React.JSX.Element {
  if (data.length === 0) {
    return (
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Monthly Breakdown</h3>
        <p className="text-sm text-slate-500">No monthly data available</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Monthly Breakdown</h3>
      <div className="space-y-4">
        {data.map((month) => (
          <div key={month.month}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{formatMonth(month.month)}</span>
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-500">{formatNumber(month.calls)} calls</span>
                <span className="text-sm font-semibold text-slate-900">
                  {formatCost(month.costUsd)}
                </span>
                <span className="w-12 text-right text-xs text-slate-400">{month.percentage}%</span>
              </div>
            </div>
            <ProgressBar percentage={month.percentage} color="bg-blue-500" />
          </div>
        ))}
      </div>
    </Card>
  );
}

interface ModelBreakdownProps {
  data: ModelCost[];
}

function ModelBreakdown({ data }: ModelBreakdownProps): React.JSX.Element {
  if (data.length === 0) {
    return (
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-slate-900">By Model</h3>
        <p className="text-sm text-slate-500">No model data available</p>
      </Card>
    );
  }

  const colors = ['bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold text-slate-900">By Model</h3>
      <div className="space-y-4 overflow-hidden">
        {data.map((model, idx) => (
          <div key={model.model} className="overflow-hidden">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-shrink truncate font-mono text-sm text-slate-700">
                {model.model}
              </span>
              <div className="flex flex-shrink-0 items-center gap-2 text-right sm:gap-4">
                <span className="hidden text-xs text-slate-500 sm:inline">{formatNumber(model.calls)} calls</span>
                <span className="text-sm font-semibold text-slate-900">
                  {formatCost(model.costUsd)}
                </span>
                <span className="w-10 text-right text-xs text-slate-400 sm:w-12">{model.percentage}%</span>
              </div>
            </div>
            <ProgressBar percentage={model.percentage} color={colors[idx % colors.length] ?? 'bg-blue-500'} />
          </div>
        ))}
      </div>
    </Card>
  );
}

interface CallTypeBreakdownProps {
  data: CallTypeCost[];
}

function CallTypeBreakdown({ data }: CallTypeBreakdownProps): React.JSX.Element {
  if (data.length === 0) {
    return (
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-slate-900">By Call Type</h3>
        <p className="text-sm text-slate-500">No call type data available</p>
      </Card>
    );
  }

  const colors: Record<string, string> = {
    research: 'bg-indigo-500',
    generate: 'bg-teal-500',
    image_generation: 'bg-pink-500',
  };

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold text-slate-900">By Call Type</h3>
      <div className="space-y-4">
        {data.map((callType) => (
          <div key={callType.callType}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium capitalize text-slate-700">
                {callType.callType.replace('_', ' ')}
              </span>
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-500">
                  {formatNumber(callType.calls)} calls
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {formatCost(callType.costUsd)}
                </span>
                <span className="w-12 text-right text-xs text-slate-400">
                  {callType.percentage}%
                </span>
              </div>
            </div>
            <ProgressBar
              percentage={callType.percentage}
              color={colors[callType.callType] ?? 'bg-slate-500'}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function LlmCostsPage(): React.JSX.Element {
  const { costs, loading, error, refresh } = useUsageCosts();

  const thisMonthCost =
    costs?.monthlyBreakdown !== undefined && costs.monthlyBreakdown.length > 0
      ? (costs.monthlyBreakdown[0]?.costUsd ?? 0)
      : 0;

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">LLM Usage Costs</h2>
          <p className="text-slate-600">Your LLM usage costs for the last 90 days</p>
        </div>
        <button
          onClick={(): void => {
            void refresh();
          }}
          disabled={loading}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
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
      ) : costs !== null ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              title="Total Cost"
              value={formatCost(costs.totalCostUsd)}
              icon={<DollarSign className="h-6 w-6 text-blue-600" />}
              subtitle="Last 90 days"
            />
            <SummaryCard
              title="This Month"
              value={formatCost(thisMonthCost)}
              icon={<TrendingUp className="h-6 w-6 text-blue-600" />}
              {...(costs.monthlyBreakdown.length > 0 &&
              costs.monthlyBreakdown[0]?.month !== undefined
                ? { subtitle: formatMonth(costs.monthlyBreakdown[0].month) }
                : {})}
            />
            <SummaryCard
              title="Total Calls"
              value={formatNumber(costs.totalCalls)}
              icon={<Zap className="h-6 w-6 text-blue-600" />}
              subtitle={`${formatNumber(costs.totalInputTokens + costs.totalOutputTokens)} tokens`}
            />
          </div>

          <MonthlyBreakdown data={costs.monthlyBreakdown} />

          <div className="grid gap-6 lg:grid-cols-2">
            <ModelBreakdown data={costs.byModel} />
            <CallTypeBreakdown data={costs.byCallType} />
          </div>
        </div>
      ) : error === null ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No usage data</h3>
            <p className="text-slate-500">Start using LLM features to see your costs here.</p>
          </div>
        </Card>
      ) : null}
    </Layout>
  );
}
