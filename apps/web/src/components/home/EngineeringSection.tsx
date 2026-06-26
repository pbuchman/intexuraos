import React from 'react';
import { Bot, FileCode, GitBranch, Layers, Shield, Terminal } from 'lucide-react';
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
            This section is for developers evaluating the engineering standards behind the platform:
            prompt versioning, service ownership, Terraform, typed results, and cross-LLM verification.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ModernCard title="Coverage Gate" icon={Shield}>
            <p className="text-neutral-600">
              Branch coverage is enforced in CI. Every exemption requires a category and justification,
              turning the test suite into executable documentation instead of a vanity metric.
            </p>
          </ModernCard>
          <ModernCard title="Strict TypeScript" icon={Layers}>
            <p className="text-neutral-600">
              Strict TypeScript catches what tests might miss:{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">noUncheckedIndexedAccess</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">exactOptionalPropertyTypes</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">strictBooleanExpressions</code>.
            </p>
          </ModernCard>
          <ModernCard title="Typed Results" icon={Bot}>
            <p className="text-neutral-600">
              Domain operations return explicit success or typed failure. Agents and adapters cannot hide
              uncertainty behind exceptions, undefined values, or unstructured model text.
            </p>
          </ModernCard>
          <ModernCard title="Service Ownership" icon={GitBranch}>
            <p className="text-neutral-600">
              Explicit service ownership keeps domain logic pure, adapters responsible for integration
              details, and each service in control of its data instead of sharing hidden state.
            </p>
          </ModernCard>
          <ModernCard title="Prompt Versioning" icon={FileCode}>
            <p className="text-neutral-600">
              Agent prompt versioning makes behavior reviewable. System prompts, repair prompts, and
              execution lessons evolve as code artifacts rather than invisible runtime folklore.
            </p>
          </ModernCard>
          <ModernCard title="Infrastructure as Code" icon={Terminal}>
            <p className="text-neutral-600">
              Everything in Terraform. Cloud Run, Cloud Functions, Pub/Sub, IAM — reproducible, auditable,
              version-controlled. No manual console clicks.
            </p>
          </ModernCard>
          <ModernCard title="Cross-LLM Verification" icon={Bot}>
            <p className="text-neutral-600">
              A cross-LLM verification pass is used where judgment matters: independent model checks review
              plans, research synthesis, and code-task outcomes before work is presented as complete.
            </p>
          </ModernCard>
        </div>
      </div>
    </section>
  );
}
