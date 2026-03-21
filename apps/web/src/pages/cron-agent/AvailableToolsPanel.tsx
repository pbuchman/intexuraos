import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components';
import type { ServiceInfo } from '@/types';
import { PreferredToolChips } from './PreferredToolChips.js';
import type { ServiceTool } from './toolPromptTemplates.js';

export function AvailableToolsPanel({
  services,
  preferredTools = [],
  onUseTool,
  onRemovePreferredTool,
  disabled = false,
}: {
  services: ServiceInfo[];
  preferredTools?: string[];
  onUseTool?: (tool: ServiceTool) => void;
  onRemovePreferredTool?: (toolName: string) => void;
  disabled?: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  if (services.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6">
      <button
        type="button"
        onClick={(): void => {
          setOpen(!open);
        }}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Available Tools
        </h3>
        {open ? (
          <ChevronDown className="h-5 w-5 text-slate-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-slate-400" />
        )}
      </button>

      {open ? (
        <div className="mt-4 space-y-4">
          {preferredTools.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                Preferred Tools
              </h4>
              <PreferredToolChips
                preferredTools={preferredTools}
                {...(onRemovePreferredTool !== undefined
                  ? { onRemove: onRemovePreferredTool }
                  : {})}
                disabled={disabled || onRemovePreferredTool === undefined}
              />
            </div>
          ) : null}
          {onUseTool !== undefined ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              Click a tool to append its prompt block to the instruction. Removing a preferred tool chip does not rewrite the instruction text.
            </div>
          ) : null}
          {services.map((service) => (
            <div key={service.key}>
              <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                {service.name}
              </h4>
              <div className="space-y-1.5">
                {service.tools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={(): void => {
                      onUseTool?.(tool);
                    }}
                    disabled={disabled || onUseTool === undefined}
                    className={`w-full rounded-md border px-3 py-2 text-left disabled:opacity-50 ${
                      preferredTools.includes(tool.name)
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                        : 'border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                    }`}
                  >
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      {tool.name}
                    </span>
                    {tool.description !== '' ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {tool.description}
                      </p>
                    ) : null}
                  </button>
                ))}
                {service.tools.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500">No tools</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
