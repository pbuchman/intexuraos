import React from 'react';
import { ArrowRight, Bot, Layers, Shield, Terminal } from 'lucide-react';
import { ModernCard } from './ModernCard.js';

export function EngineeringSection(): React.JSX.Element {
  return (
    <section className="bg-neutral-50 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Engineering Philosophy
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Coverage is a gate.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              Not a target.
            </span>
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-neutral-600">
            Every branch is tested or explicitly exempted. Every operation returns{' '}
            <code className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold">Result&lt;T, E&gt;</code>
            . No silent failures. No <code className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold">any</code> types.
            The compiler and the test suite are both gates that must pass before code ships.
          </p>
          <p className="text-sm leading-relaxed text-neutral-500">
            This section is for developers evaluating the engineering standards behind the platform.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ModernCard title="Every Path Tested" icon={Shield}>
            <p className="text-neutral-600">
              100% branch coverage. CI fails on any unaccounted branch. Every exemption requires a category
              and justification. The test suite is the specification — if it passes, it works.
            </p>
          </ModernCard>
          <ModernCard title="The Compiler Is a Gate" icon={Layers}>
            <p className="text-neutral-600">
              Strict TypeScript catches what tests might miss:{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">noUncheckedIndexedAccess</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">exactOptionalPropertyTypes</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">strictBooleanExpressions</code>.
            </p>
          </ModernCard>
          <ModernCard title="Swap Any Part" icon={Layers}>
            <p className="text-neutral-600">
              Hexagonal architecture: domain logic is pure — no database imports, no HTTP frameworks.
              Firestore, WhatsApp, GitHub are just adapters. Swap any without touching business rules.
            </p>
          </ModernCard>
          <ModernCard title="Extreme Ownership" icon={Shield}>
            <p className="mb-3 text-neutral-600">
              Based on Jocko Willink&apos;s principles. CI failure = your problem. No &quot;other services
              failed&quot; rationalizations. Discovery creates ownership.
            </p>
            <a
              href="https://github.com/pbuchman/intexuraos/blob/main/docs/philosophy/extreme-ownership.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-semibold text-cyan-600 transition-colors hover:text-cyan-700"
            >
              Read Philosophy <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </ModernCard>
          <ModernCard title="AI-Native Development" icon={Bot}>
            <p className="text-neutral-600">
              AI isn&apos;t a feature — it&apos;s a team member. Custom skills for Linear issues, Sentry triage,
              documentation generation. Cross-linking between all artifacts is automatic.
            </p>
          </ModernCard>
          <ModernCard title="Infrastructure as Code" icon={Terminal}>
            <p className="text-neutral-600">
              Everything in Terraform. Cloud Run, Cloud Functions, Pub/Sub, IAM — reproducible, auditable,
              version-controlled. No manual console clicks.
            </p>
          </ModernCard>
        </div>
      </div>
    </section>
  );
}
