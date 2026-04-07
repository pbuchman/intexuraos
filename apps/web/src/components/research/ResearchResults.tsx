import { useState } from 'react';
import { CheckCircle, Copy } from 'lucide-react';
import { Card, MarkdownContent } from '@/components';
import type { LlmResult, Research } from '@/services/researchAgentApi.types';
import { getModelDisplayName, formatTokenCount, formatCost, formatNumber } from './shared.js';
import { StatusDot, CollapsibleInputContext } from './ProcessingStatus.js';

interface LlmResultCardProps {
  result: LlmResult;
  onCopy: (text: string) => void;
  copied: boolean;
}

function LlmResultCard({ result, onCopy, copied }: LlmResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const hasTokenInfo = result.inputTokens !== undefined && result.outputTokens !== undefined;
  const hasCost = result.costUsd !== undefined;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium dark:text-slate-100">{getModelDisplayName(result.model)}</span>
          {hasTokenInfo ? (
            <span className="text-sm text-slate-400">
              in: {formatTokenCount(result.inputTokens ?? 0)} / out:{' '}
              {formatTokenCount(result.outputTokens ?? 0)}
            </span>
          ) : null}
          {hasCost ? (
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              {formatCost(result.costUsd ?? 0)}
            </span>
          ) : null}
        </div>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined && result.result !== '' ? (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          {hasTokenInfo ? (
            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
              <span>
                Input: <strong className="dark:text-slate-100">{formatNumber(result.inputTokens ?? 0)}</strong> tokens
              </span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span>
                Output: <strong className="dark:text-slate-100">{formatNumber(result.outputTokens ?? 0)}</strong> tokens
              </span>
              {hasCost ? (
                <>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>
                    Cost:{' '}
                    <strong className="text-green-600 dark:text-green-400">{formatCost(result.costUsd ?? 0)}</strong>
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={(): void => {
                onCopy(result.result ?? '');
              }}
              className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-700">
            <MarkdownContent content={result.result} />
          </div>
          {result.sources !== undefined && result.sources.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="mb-2 text-sm font-medium dark:text-slate-200">Sources</h4>
              <ul className="text-sm text-blue-600 dark:text-blue-400">
                {result.sources.map((source, i) => (
                  <li key={i}>
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && result.error !== undefined && result.error !== '' ? (
        <div className="border-t border-slate-200 bg-red-50 p-4 dark:border-slate-700 dark:bg-red-900/30">
          <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}

interface ResearchResultsProps {
  research: Research;
  copiedSection: string | null;
  onCopy: (text: string, section: string) => void;
}

export function ResearchResults({ research, copiedSection, onCopy }: ResearchResultsProps): React.JSX.Element | null {
  const completedResults = research.llmResults.filter((r) => r.status === 'completed');
  const hasInputContexts =
    research.inputContexts !== undefined && research.inputContexts.length > 0;
  const isSingleModelResearch = completedResults.length === 1 && !hasInputContexts;
  const singleResult = isSingleModelResearch ? completedResults[0] : undefined;
  const hasResults = research.llmResults.some(
    (r) =>
      (r.result !== undefined && r.result !== '') || (r.error !== undefined && r.error !== '')
  );
  const showIndividualResults = !isSingleModelResearch && hasResults;

  return (
    <>
      {/* Research Summary - show when we have usage data */}
      {research.totalInputTokens !== undefined ||
      research.llmResults.some((r) => r.inputTokens !== undefined) ? (
        <Card title="Research Summary" className="mb-6">
          <div className="flex flex-wrap gap-6">
            {research.totalDurationMs !== undefined ? (
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Duration</p>
                <p className="text-lg font-semibold dark:text-slate-100">
                  {(research.totalDurationMs / 1000).toFixed(1)}s
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Input Tokens</p>
              <p className="text-lg font-semibold dark:text-slate-100">
                {(
                  research.totalInputTokens ??
                  research.llmResults.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0)
                ).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Output Tokens</p>
              <p className="text-lg font-semibold dark:text-slate-100">
                {(
                  research.totalOutputTokens ??
                  research.llmResults.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0)
                ).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total Cost</p>
              <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                $
                {(
                  research.totalCostUsd ??
                  research.llmResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
                ).toFixed(4)}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Synthesis Report */}
      {research.synthesizedResult !== undefined && research.synthesizedResult !== '' ? (
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Synthesis Report</h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Synthesized by {getModelDisplayName(research.synthesisModel)}
              </span>
            </div>
            <button
              type="button"
              onClick={(): void => {
                onCopy(research.synthesizedResult ?? '', 'synthesis');
              }}
              className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
              title={copiedSection === 'synthesis' ? 'Copied!' : 'Copy'}
            >
              {copiedSection === 'synthesis' ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
            <MarkdownContent content={research.synthesizedResult} />
          </div>
        </Card>
      ) : null}

      {/* Single Model Report */}
      {research.synthesizedResult === undefined &&
      research.status === 'completed' &&
      singleResult?.result !== undefined &&
      singleResult.result !== '' ? (
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Research Report</h3>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <span>
                  Generated by {getModelDisplayName(singleResult.model)}
                </span>
                {singleResult.inputTokens !== undefined && singleResult.outputTokens !== undefined ? (
                  <span className="text-slate-400">
                    in: {formatTokenCount(singleResult.inputTokens)} / out:{' '}
                    {formatTokenCount(singleResult.outputTokens)}
                  </span>
                ) : null}
                {singleResult.costUsd !== undefined ? (
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {formatCost(singleResult.costUsd)}
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={(): void => {
                onCopy(singleResult.result ?? '', 'main-report');
              }}
              className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
              title={copiedSection === 'main-report' ? 'Copied!' : 'Copy'}
            >
              {copiedSection === 'main-report' ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
            <MarkdownContent content={singleResult.result} />
          </div>
          {singleResult.sources !== undefined && singleResult.sources.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="mb-2 text-sm font-medium dark:text-slate-200">Sources</h4>
              <ul className="text-sm text-blue-600 dark:text-blue-400">
                {singleResult.sources.map((source, i) => (
                  <li key={i}>
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Synthesis Error */}
      {research.synthesisError !== undefined && research.synthesisError !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <h3 className="font-medium text-red-800 dark:text-red-300">Synthesis Failed</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{research.synthesisError}</p>
        </div>
      ) : null}

      {/* Individual LLM Results */}
      {showIndividualResults ? (
        <div>
          <h3 className="mb-4 text-xl font-bold text-slate-900 dark:text-slate-100">Individual LLM Results</h3>
          <div className="space-y-4">
            {research.inputContexts !== undefined && research.inputContexts.length > 0
              ? research.inputContexts.map((ctx, idx) => (
                  <CollapsibleInputContext key={`ctx-${ctx.id}`} ctx={ctx} index={idx} showFull />
                ))
              : null}
            {research.llmResults
              .filter(
                (r) =>
                  (r.result !== undefined && r.result !== '') ||
                  (r.error !== undefined && r.error !== '')
              )
              .map((result) => (
                <LlmResultCard
                  key={result.provider}
                  result={result}
                  onCopy={(text): void => {
                    onCopy(text, result.provider);
                  }}
                  copied={copiedSection === result.provider}
                />
              ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
