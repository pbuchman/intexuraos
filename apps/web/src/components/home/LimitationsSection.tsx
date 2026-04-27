import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function LimitationsSection(): React.JSX.Element {
  const limitations = [
    'WhatsApp is the only mobile channel — no SMS, email, or native push',
    'WhatsApp 24-hour messaging policy — the system cannot reach you after a day of silence until you send the next message',
    'Google Calendar only — no Outlook or Apple Calendar',
    'Linear for project tracking — no Jira or Asana',
    'Android-only notification capture — iOS not supported',
    'English and Polish natively — other languages may work but are not tested',
    'Two worker machines (any Mac or Linux computer) maximum — a primary and a fallback',
    'Designed for individual use — no shared workspaces or team features',
    'Design review before code execution — a deliberate quality gate',
    'No recurring events or tasks — single instances only',
    'API keys configured manually — the system validates each before accepting',
  ];

  return (
    <section className="bg-white px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-700">
            Deliberate Scope Decisions
          </p>
        </div>
        <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
          What this system does not do.
        </h2>
        <p className="mb-10 max-w-2xl text-lg leading-relaxed text-neutral-600">
          IntexuraOS is designed for individual power users who want depth in one workflow over breadth across many.
          These are deliberate scope decisions, not gaps on a roadmap.
        </p>

        <ul className="space-y-3">
          {limitations.map((limitation) => (
            <li key={limitation} className="flex items-start gap-3 text-neutral-600">
              <span className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
              {limitation}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
