import React from 'react';
import { StatBlock } from './StatBlock.js';

export function StatsSection(): React.JSX.Element {
  return (
    <section className="bg-white px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-neutral-500">
          Built for one person. Not a team tool.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-8">
          <StatBlock value="24" label="Services" />
          <StatBlock value="5" label="Direct Tools" />
          <StatBlock value="5" label="AI Providers" />
          <StatBlock value="15" label="AI Models" />
          <StatBlock value="1" label="Developer" />
        </div>
      </div>
    </section>
  );
}
