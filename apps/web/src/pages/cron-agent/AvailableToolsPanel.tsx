import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components';
import type { ServiceInfo } from '@/types';

export function AvailableToolsPanel({
  services,
}: {
  services: ServiceInfo[];
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
          {services.map((service) => (
            <div key={service.key}>
              <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                {service.name}
              </h4>
              <div className="space-y-1.5">
                {service.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                  >
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      {tool.name}
                    </span>
                    {tool.description !== '' ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {tool.description}
                      </p>
                    ) : null}
                  </div>
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
