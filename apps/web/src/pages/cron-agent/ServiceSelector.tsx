import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ServiceInfo } from '@/types';
import { PreferredToolChips } from './PreferredToolChips.js';
import type { ServiceTool } from './toolPromptTemplates.js';

export function ServiceSelector({
  services,
  servicesLoading,
  servicesError,
  selectedKeys,
  preferredTools,
  onToggle,
  onSelectTool,
  onRemovePreferredTool,
  disabled,
}: {
  services: ServiceInfo[];
  servicesLoading: boolean;
  servicesError: string | null;
  selectedKeys: Set<string>;
  preferredTools: string[];
  onToggle: (key: string) => void;
  onSelectTool: (tool: ServiceTool) => void;
  onRemovePreferredTool: (toolName: string) => void;
  disabled: boolean;
}): React.JSX.Element {
  const [showTools, setShowTools] = useState(false);

  const selectedServices = services.filter((s) => selectedKeys.has(s.key));
  const totalToolCount = selectedServices.reduce((sum, s) => sum + s.tools.length, 0);

  return (
    <>
      {/* Services multi-select */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
          Services <span className="text-red-500">*</span>
        </label>
        {servicesLoading ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Loading available services...
          </div>
        ) : servicesError !== null ? (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>Failed to load services: {servicesError}</span>
          </div>
        ) : services.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            No services available
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {services.map((service) => {
              const isSelected = selectedKeys.has(service.key);
              return (
                <button
                  key={service.key}
                  type="button"
                  onClick={(): void => {
                    onToggle(service.key);
                  }}
                  disabled={disabled}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-400'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400'
                        : 'border-slate-300 dark:border-slate-500'
                    }`}
                  >
                    {isSelected ? '\u2713' : ''}
                  </span>
                  <span>{service.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs ${
                      isSelected
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {String(service.tools.length)} {service.tools.length === 1 ? 'tool' : 'tools'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selectedKeys.size === 0 && !servicesLoading && services.length > 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Select at least one service
          </p>
        )}
      </div>

      {/* Available Tools (expandable) */}
      {selectedServices.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={(): void => {
              setShowTools((prev) => !prev);
            }}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
          >
            <span>
              Available Tools ({String(totalToolCount)} across{' '}
              {String(selectedServices.length)}{' '}
              {selectedServices.length === 1 ? 'service' : 'services'})
            </span>
            {showTools ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {showTools && (
            <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              {preferredTools.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Preferred Tools
                  </div>
                  <PreferredToolChips
                    preferredTools={preferredTools}
                    onRemove={onRemovePreferredTool}
                    disabled={disabled}
                  />
                </div>
              )}
              <div className="mb-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                Click a tool name to add it to the instruction with a ready-to-edit argument template.
              </div>
              <div className="space-y-4">
                {selectedServices.map((service) => (
                  <div key={service.key}>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      {service.name}
                    </h4>
                    <ul className="space-y-1.5">
                      {service.tools.map((tool) => (
                        <li
                          key={`${service.key}-${tool.name}`}
                          className="text-sm"
                        >
                          <button
                            type="button"
                            onClick={(): void => {
                              onSelectTool(tool);
                            }}
                            disabled={disabled}
                            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                              preferredTools.includes(tool.name)
                                ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                                {tool.name}
                              </span>
                              {preferredTools.includes(tool.name) && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                                  Preferred
                                </span>
                              )}
                            </div>
                            {tool.description !== '' && (
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {tool.description}
                              </div>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
