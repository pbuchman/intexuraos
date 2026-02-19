import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Code2,
  Container,
  GitPullRequest,
  Layers,
  Mail,
  MessageSquare,
  Mic,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

// --- Brand Icons ---

function LinkedinIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// --- Reusable Components ---

function BrutalistCard({
  children,
  className = '',
  title,
  icon: Icon,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ElementType;
}): React.JSX.Element {
  return (
    <div
      className={`relative border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-center gap-3 border-b-2 border-black dark:border-white/20 pb-3">
          {Icon && <Icon className="h-6 w-6 stroke-[2.5px] dark:text-white" />}
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight dark:text-white">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

// --- Terminal Animation ---

const TERMINAL_LINES = [
  { text: '$ whatsapp: "Fix the Safari login redirect loop"', delay: 0, color: 'text-green-400' },
  { text: '  → Intent classified: code (confidence: 0.96)', delay: 800, color: 'text-cyan-400' },
  { text: '  → Code Agent: creating task...', delay: 1600, color: 'text-neutral-400' },
  { text: '  → Dispatching to orchestrator (HMAC-signed)', delay: 2400, color: 'text-neutral-400' },
  { text: '  → Docker container spawned (worktree: fix-safari-login)', delay: 3200, color: 'text-yellow-400' },
  { text: '  → Phase 1: Design agent enriching Linear issue...', delay: 4000, color: 'text-purple-400' },
  { text: '  → Phase 2: Execution agent writing code...', delay: 5000, color: 'text-blue-400' },
  { text: '  → Running CI: typecheck ✓ lint ✓ tests ✓ (847 passed)', delay: 6200, color: 'text-green-400' },
  { text: '  → PR #847 created → Linear INT-592 → In Review', delay: 7400, color: 'text-emerald-400' },
  { text: '  → WhatsApp: "PR ready for review" ✓', delay: 8400, color: 'text-green-300' },
];

function AnimatedTerminal(): React.JSX.Element {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const [index, line] of TERMINAL_LINES.entries()) {
      const timer = setTimeout(() => {
        setVisibleLines(index + 1);
      }, line.delay);
      timers.push(timer);
    }

    const resetTimer = setTimeout(() => {
      setVisibleLines(0);
      // Restart the animation
      const restartTimer = setTimeout(() => {
        for (const [index, line] of TERMINAL_LINES.entries()) {
          const timer = setTimeout(() => {
            setVisibleLines(index + 1);
          }, line.delay);
          timers.push(timer);
        }
      }, 500);
      timers.push(restartTimer);
    }, 11000);
    timers.push(resetTimer);

    return (): void => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [visibleLines]);

  return (
    <div className="overflow-hidden rounded-none border-2 border-black dark:border-white/20 bg-neutral-950 font-mono text-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <div className="h-3 w-3 rounded-full bg-red-500" />
        <div className="h-3 w-3 rounded-full bg-yellow-500" />
        <div className="h-3 w-3 rounded-full bg-green-500" />
        <span className="ml-2 text-xs text-neutral-500">intexuraos — autonomous pipeline</span>
      </div>
      <div className="p-4 md:p-6">
        <div className="space-y-1">
          {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className={`${line.color} transition-opacity duration-300`}
            >
              {line.text}
              {i === visibleLines - 1 && <span className="animate-pulse">▊</span>}
            </div>
          ))}
          {visibleLines === 0 && (
            <div className="text-green-400">
              <span className="animate-pulse">▊</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Stat Counter ---

function StatBlock({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="text-center">
      <div className="text-4xl font-black tracking-tighter md:text-5xl">{value}</div>
      <div className="mt-1 font-mono text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
    </div>
  );
}

// --- Pipeline Step ---

function PipelineStep({
  number,
  title,
  description,
  icon: Icon,
  accent,
}: {
  number: string;
  title: string;
  description: string;
  icon: React.ElementType;
  accent: string;
}): React.JSX.Element {
  return (
    <div className="group relative">
      <div className={`mb-4 inline-flex items-center gap-3 border-2 border-black dark:border-white/20 ${accent} px-4 py-2 font-mono text-sm font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)]`}>
        <Icon className="h-4 w-4" />
        {number}
      </div>
      <h3 className="mb-2 text-xl font-black uppercase tracking-tight dark:text-white">{title}</h3>
      <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}

// --- Sections ---

function HeroSection(): React.JSX.Element {
  return (
    <section className="relative flex min-h-[95vh] flex-col justify-center border-b-4 border-black dark:border-white/10 bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 px-6 py-24">
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          <div>
            <div className="mb-6 flex flex-wrap gap-3">
              <a
                href="https://www.linkedin.com/in/piotrbuchman/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <LinkedinIcon className="h-3.5 w-3.5" /> LinkedIn
              </a>
              <a
                href="https://github.com/pbuchman/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <GithubIcon className="h-3.5 w-3.5" /> GitHub
              </a>
              <a
                href="mailto:kontakt@pbuchman.com"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            </div>

            <p className="mb-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
              IntexuraOS v3.0.0
            </p>

            <h1 className="mb-8 text-5xl font-black uppercase leading-[0.9] tracking-tighter text-black dark:text-white md:text-7xl lg:text-[5.5rem]">
              The software that{' '}
              <span className="bg-cyan-600 px-2 text-white dark:bg-cyan-500">builds</span>
              <br />
              itself.
            </h1>

            <p className="mb-10 max-w-xl text-xl leading-relaxed text-neutral-700 dark:text-neutral-300">
              Send a WhatsApp message describing a bug. Walk away.
              Come back to a pull request — tests passing, Linear issue updated,
              code review waiting. No keyboard required.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Link
                to="/login"
                className="group flex items-center justify-center gap-2 border-2 border-black bg-cyan-600 px-8 py-4 text-lg font-bold text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1 hover:bg-cyan-700 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
              >
                LOG IN <Terminal className="h-5 w-5" />
              </Link>
              <a
                href="https://github.com/pbuchman/intexuraos"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-8 py-4 text-lg font-bold text-black dark:text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-1 hover:bg-neutral-100 dark:hover:bg-slate-700"
              >
                VIEW SOURCE <GithubIcon className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div className="hidden lg:block">
            <AnimatedTerminal />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8 text-black dark:text-white">
        <StatBlock value="20" label="Services" />
        <StatBlock value="4" label="Workers" />
        <StatBlock value="22" label="Packages" />
        <StatBlock value="17" label="AI Models" />
        <StatBlock value="100%" label="Branch Coverage" />
        <StatBlock value="1" label="Developer" />
      </div>
    </section>
  );
}

function SelfBuildingSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-50 dark:bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
          The Self-Building System
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Describe the change. <br />
          Receive a pull request.
        </h2>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Most AI coding tools wait for you to sit at a keyboard. IntexuraOS doesn&apos;t. You describe
          what needs to change. The platform designs the approach, writes the code in a sandboxed Docker
          container, runs CI, creates the PR, and updates the Linear issue. If verification fails,
          it retries with preserved context.
        </p>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <PipelineStep
            number="Phase 1"
            title="Design"
            description="A design agent analyzes the task, enriches the Linear issue with technical context, creates subissues for complex work, and labels it code-task when the plan is sound."
            icon={Brain}
            accent="bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300"
          />
          <PipelineStep
            number="Phase 2"
            title="Execute"
            description="A strict execution agent picks up the labeled issue, writes code in Docker with git worktree isolation, runs the full CI suite, and creates a pull request."
            icon={Code2}
            accent="bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300"
          />
          <PipelineStep
            number="Verify"
            title="Check"
            description="Gemini-powered completion verifier checks the work against a contract: correct files modified, tests passing, PR created. If not, the system resumes automatically."
            icon={CheckCircle2}
            accent="bg-green-100 dark:bg-green-900/40 dark:text-green-300"
          />
          <PipelineStep
            number="Deliver"
            title="Ship"
            description="PR created, Linear issue moved to In Review, WhatsApp notification sent. You review and merge when ready. The platform did the rest."
            icon={GitPullRequest}
            accent="bg-cyan-100 dark:bg-cyan-900/40 dark:text-cyan-300"
          />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <BrutalistCard title="Docker Isolation" icon={Container}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Every task runs in its own container — capabilities dropped, non-root execution, read-only
              secrets, network isolation blocking cloud metadata. No task can touch another.
            </p>
          </BrutalistCard>
          <BrutalistCard title="HMAC-Signed Dispatch" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Worker communication uses nonce + timestamp + HMAC-SHA256 through Cloudflare Access tunnels.
              No exposed endpoints. No shared secrets between tasks.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Automatic Retry" icon={Zap}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Failed tasks preserve full context and retry with a 1-minute cool-off. Messages queue
              during execution and trigger resume on completed tasks.
            </p>
          </BrutalistCard>
        </div>
      </div>
    </section>
  );
}

function CouncilSection(): React.JSX.Element {
  const providers = [
    { name: 'ANTHROPIC', models: 'Opus 4.5, Sonnet, Haiku', role: 'Analysis, validation, autonomous coding', color: 'border-orange-500/50' },
    { name: 'OPENAI', models: 'GPT-5.2, o4-mini, Image 1', role: 'Deep research, synthesis, embeddings', color: 'border-green-500/50' },
    { name: 'GOOGLE', models: 'Gemini 2.5 Pro, Flash', role: 'Classification, routing, image gen', color: 'border-blue-500/50' },
    { name: 'PERPLEXITY', models: 'Sonar, Pro, Deep Research', role: 'Real-time web search, citations', color: 'border-purple-500/50' },
    { name: 'ZAI', models: 'GLM-4.7, GLM-4.7-Flash', role: 'Multilingual, cost-efficient, guest access', color: 'border-cyan-500/50' },
  ];

  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500">
          The Council of AI
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter md:text-6xl">
          Five models debate. <br />
          You get the truth.
        </h2>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-neutral-400">
          Single-model assistants hallucinate. A council of models cross-checks. When three agree and
          two disagree, that disagreement is surfaced — not hidden. Every claim traces back to which
          model said it and why.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {providers.map((provider) => (
            <div
              key={provider.name}
              className={`flex flex-col border-2 ${provider.color} bg-neutral-900/50 p-6 transition-all hover:bg-neutral-800/80 hover:border-white/40`}
            >
              <div className="mb-3 text-xl font-black tracking-tight">{provider.name}</div>
              <div className="mb-2 font-mono text-xs leading-relaxed text-neutral-400">{provider.models}</div>
              <div className="mt-auto font-mono text-xs text-neutral-600">{provider.role}</div>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-neutral-800 pt-8">
          <p className="font-mono text-sm text-neutral-500">
            Specify models in natural language: &quot;Research AI trends with Claude and GPT&quot; — or let
            the system choose. Every LLM call is tracked: model, tokens, cost. Full transparency.
          </p>
        </div>
      </div>
    </section>
  );
}

function VoiceSection(): React.JSX.Element {
  const actions = [
    { input: 'Fix the Safari login redirect', output: 'PR #847 created, CI passing, Linear updated', icon: Code2, tag: 'CODE' },
    { input: 'Research quantum computing breakthroughs', output: '5-model synthesis with citations and confidence scores', icon: Brain, tag: 'RESEARCH' },
    { input: 'Schedule sync with engineering Tuesday 2pm', output: 'Preview shown, approved via emoji, event created', icon: Layers, tag: 'CALENDAR' },
    { input: 'Remind me to review Q4 report by Friday', output: 'Task extracted with priority and deadline', icon: CheckCircle2, tag: 'TODO' },
    { input: 'Save this link about TypeScript 5.0', output: 'AI summary generated, metadata extracted, bookmarked', icon: MessageSquare, tag: 'LINK' },
    { input: 'Create a Linear issue for the auth refactor', output: 'Issue filed with AI-generated title and description', icon: Bot, tag: 'LINEAR' },
  ];

  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-slate-900 dark:to-slate-950 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
          Voice-First Intelligence
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Speak. <br />
          It understands.
        </h2>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Seven action types. One interface. Send a WhatsApp voice note or text message.
          The commands-agent classifies intent with a 5-step decision tree, routes to the right agent,
          and executes. Polish and English supported.
        </p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => (
            <div
              key={action.tag}
              className="group border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-1"
            >
              <div className="mb-3 flex items-center gap-2">
                <action.icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <span className="font-mono text-xs font-bold tracking-wider text-cyan-700 dark:text-cyan-400">
                  {action.tag}
                </span>
              </div>
              <div className="mb-3 flex items-start gap-2">
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                <p className="text-sm font-bold italic text-black dark:text-white">
                  &quot;{action.input}&quot;
                </p>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                → {action.output}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EngineeringSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
          Engineering Philosophy
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Coverage is a gate. <br />
          Not a target.
        </h2>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Every branch is tested or explicitly exempted. Every operation returns{' '}
          <code className="bg-neutral-100 dark:bg-slate-800 px-1.5 py-0.5 text-sm font-bold">Result&lt;T, E&gt;</code>
          . No silent failures. No <code className="bg-neutral-100 dark:bg-slate-800 px-1.5 py-0.5 text-sm font-bold">any</code> types.
          The compiler and the test suite are both gates that must pass before code ships.
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <BrutalistCard title="100% Branch Coverage" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400">
              CI fails on any unaccounted branch. Every exemption requires a category and justification.
              The test suite is the specification.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Strict TypeScript" icon={Layers}>
            <p className="text-neutral-600 dark:text-neutral-400">
              <code className="text-xs">noUncheckedIndexedAccess</code>,{' '}
              <code className="text-xs">exactOptionalPropertyTypes</code>,{' '}
              <code className="text-xs">strictBooleanExpressions</code>. The compiler catches what tests might miss.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Hexagonal Architecture" icon={Layers}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Domain logic is pure — no database imports, no HTTP frameworks. Firestore, WhatsApp, GitHub
              are just adapters. Swap any without touching business rules.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Extreme Ownership" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400 mb-3">
              Based on Jocko Willink&apos;s principles. CI failure = your problem. No &quot;other services
              failed&quot; rationalizations. Discovery creates ownership.
            </p>
            <a
              href="https://github.com/pbuchman/intexuraos/blob/main/docs/philosophy/extreme-ownership.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 font-mono text-xs font-bold text-cyan-700 dark:text-cyan-400 hover:underline"
            >
              Read Philosophy <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </BrutalistCard>
          <BrutalistCard title="AI-Native Development" icon={Bot}>
            <p className="text-neutral-600 dark:text-neutral-400">
              AI isn&apos;t a feature — it&apos;s a team member. Custom skills for Linear issues, Sentry triage,
              documentation generation. Cross-linking between all artifacts is automatic.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Infrastructure as Code" icon={Terminal}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Everything in Terraform. Cloud Run, Cloud Functions, Pub/Sub, IAM — reproducible, auditable,
              version-controlled. No manual console clicks.
            </p>
          </BrutalistCard>
        </div>
      </div>
    </section>
  );
}

function AboutSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 text-4xl font-black uppercase tracking-tighter md:text-6xl">
          One developer. <br />
          Zero excuses.
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-neutral-400">
          IntexuraOS is what happens when a single engineer refuses to accept that one person can&apos;t
          build and maintain a 46-component distributed system with enterprise-grade reliability.
          The answer isn&apos;t working harder. It&apos;s building agents that work for you — then building
          agents that build agents.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://www.linkedin.com/in/piotrbuchman/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <LinkedinIcon className="h-4 w-4" /> Piotr Buchman
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <GithubIcon className="h-4 w-4" /> Source Code
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <ArrowRight className="h-4 w-4" /> Changelog
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="bg-white dark:bg-slate-900 px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
        <div>
          <h3 className="mb-1 text-2xl font-black uppercase tracking-tighter dark:text-white">IntexuraOS</h3>
          <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            The software that builds itself. v3.0.0
          </p>
        </div>
        <p className="font-mono text-xs text-neutral-400">
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://pbuchman.com" className="hover:text-cyan-600 dark:hover:text-cyan-400">
            Piotr Buchman
          </a>
        </p>
      </div>
    </footer>
  );
}

// --- Main Page ---

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-slate-950 font-sans text-black dark:text-white selection:bg-cyan-200 selection:text-black dark:selection:bg-cyan-800 dark:selection:text-white">
      <HeroSection />
      <StatsSection />
      <SelfBuildingSection />
      <CouncilSection />
      <VoiceSection />
      <EngineeringSection />
      <AboutSection />
      <Footer />
    </div>
  );
}
