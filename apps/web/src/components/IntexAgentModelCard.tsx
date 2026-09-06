import { useEffect, useRef } from 'react';
import type { IntexAgentModel } from '@intexuraos/llm-contract';
import type { UseIntexAgentModelResult } from '@/hooks/useIntexAgentModel.js';
import { Card } from './ui/Card.js';

type AvailableSelector = Extract<UseIntexAgentModelResult, { availability: 'available' }>;

export interface IntexAgentModelCardProps {
  selector: AvailableSelector;
}

export function IntexAgentModelCard({ selector }: IntexAgentModelCardProps): React.JSX.Element {
  const selectRef = useRef<HTMLSelectElement>(null);
  const mountedRef = useRef(true);
  const describedBy = selector.intexAgentModelError === null
    ? 'intex-agent-model-description'
    : 'intex-agent-model-description intex-agent-model-error';

  useEffect((): (() => void) => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const save = (model: IntexAgentModel | null): void => {
    void selector.setIntexAgentModel(model).then(
      () => {
        if (mountedRef.current) selectRef.current?.focus();
      },
      () => {
        if (mountedRef.current) selectRef.current?.focus();
      }
    );
  };

  return (
    <Card className="mb-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-900 dark:text-slate-100">Intex Agent model</h3>
          <p id="intex-agent-model-description" className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">
            Choose the model Intex Agent uses for conversations. Changes save immediately and use
            the IntexuraOS platform key.
          </p>
          {selector.intexAgentModelError !== null ? (
            <p id="intex-agent-model-error" role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
              {selector.intexAgentModelError}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {selector.savingIntexAgentModel ? (
            <div
              aria-label="Saving Intex Agent model"
              role="status"
              className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
            />
          ) : null}
          <label htmlFor="intex-agent-model" className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Intex Agent model
          </label>
          <select
            ref={selectRef}
            id="intex-agent-model"
            value={selector.effectiveModel}
            aria-busy={selector.savingIntexAgentModel ? 'true' : undefined}
            aria-describedby={describedBy}
            onChange={(event): void => {
              save(event.target.value as IntexAgentModel);
            }}
            className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-auto dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {selector.options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {selector.explicitModel !== null ? (
            <button
              type="button"
              aria-label="Use default Intex Agent model"
              onClick={(): void => {
                save(null);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-auto dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Use default
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
