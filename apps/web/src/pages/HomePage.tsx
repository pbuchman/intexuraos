import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Brain,
  CheckSquare,
  Database,
  FileText,
  GitBranch,
  Layers,
  Mic,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

// --- Components ---

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
      className={`relative border-2 border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-center gap-3 border-b-2 border-black pb-3">
          {Icon && <Icon className="h-6 w-6 stroke-[2.5px]" />}
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function SectionHeading({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <h2
      className={`mb-12 text-4xl font-black uppercase tracking-tighter md:text-6xl ${className}`}
    >
      {children}
    </h2>
  );
}

// --- Sections ---

function HeroSection(): React.JSX.Element {
  return (
    <section className="relative flex min-h-[90vh] flex-col justify-center border-b-4 border-black bg-yellow-400 px-6 py-24 pattern-dots pattern-black pattern-bg-transparent pattern-size-4 pattern-opacity-10">
      <div className="mx-auto w-full max-w-7xl">
        <div className="max-w-4xl">
          <div className="mb-6 inline-block border-2 border-black bg-white px-4 py-2 font-mono text-sm font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            v2.0 • Staff Engineer Edition
          </div>
          <h1 className="mb-8 text-6xl font-black uppercase leading-[0.9] tracking-tighter text-black md:text-8xl lg:text-[7rem]">
            Your brain is for <span className="bg-white px-2 text-black">thinking</span>
            <br /> not remembering.
          </h1>
          <p className="mb-10 max-w-2xl text-xl font-medium leading-relaxed text-neutral-900 md:text-2xl">
            IntexuraOS is the autonomous cognitive layer that sits between your chaotic inputs and
            your structured life. Capture via WhatsApp. Reason via Multi-LLM. Execute via Agents.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Link
              to="/login"
              className="group flex items-center justify-center gap-2 border-2 border-black bg-black px-8 py-4 text-lg font-bold text-white shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]"
            >
              DEPLOY SYSTEM <Terminal className="h-5 w-5" />
            </Link>
            <a
              href="https://github.com/your-org/intexuraos"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2 border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1 hover:bg-neutral-100 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
              VIEW SOURCE CODE <GitBranch className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoSection(): React.JSX.Element {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 2000);
    return (): void => {
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="border-b-4 border-black bg-white px-6 py-24">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2">
        <div className="flex flex-col justify-center">
          <SectionHeading>
            The Loop: <br />
            <span className="text-cyan-600">Capture</span> → <br />
            <span className="text-purple-600">Synthesize</span> → <br />
            <span className="text-green-600">Execute</span>
          </SectionHeading>
          <p className="text-xl font-medium text-neutral-600">
            You act as the Commander. IntexuraOS acts as your Staff. Speak your intent, and a fleet
            of specialized AI agents executes it autonomously.
          </p>
        </div>

        <div className="relative aspect-square max-h-[600px] w-full border-4 border-black bg-neutral-100 p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          {/* Step 1: Voice Input */}
          <div
            className={`absolute left-8 top-8 w-[80%] border-2 border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 0 ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-neutral-500">
              <Mic className="h-4 w-4" /> USER INPUT (WHATSAPP)
            </div>
            <p className="text-lg font-bold italic">
              "Research the latest Hexagonal Architecture patterns and schedule a review meeting for
              Friday."
            </p>
          </div>

          {/* Step 2: Synthesis */}
          <div
            className={`absolute right-8 top-1/3 w-[80%] border-2 border-black bg-purple-100 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 1 ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-purple-700">
              <Brain className="h-4 w-4" /> COUNCIL OF AI
            </div>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" /> Intent: Research + Calendar
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" /> Agents: ResearchAgent,
                CalendarAgent
              </div>
            </div>
          </div>

          {/* Step 3: Execution */}
          <div
            className={`absolute bottom-8 left-8 w-[90%] border-2 border-black bg-green-100 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-green-700">
              <CheckSquare className="h-4 w-4" /> EXECUTION LOG
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 border border-black/10 bg-white p-2">
                <Database className="h-4 w-4 text-neutral-400" />
                <span className="font-mono text-xs font-bold">NOTION</span>
                <span className="text-sm">Created page "Hexagonal Arch Research"</span>
              </div>
              <div className="flex items-center gap-3 border border-black/10 bg-white p-2">
                <Layers className="h-4 w-4 text-neutral-400" />
                <span className="font-mono text-xs font-bold">CALENDAR</span>
                <span className="text-sm">Event created: "Arch Review" (Fri 2PM)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CouncilSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-7xl text-center">
        <h2 className="mb-16 font-mono text-3xl font-bold uppercase tracking-widest text-neutral-500">
          Powered by The Council
        </h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {[
            { name: 'CLAUDE 3.5', role: 'Synthesis & Code' },
            { name: 'GPT-5', role: 'Reasoning & Planning' },
            { name: 'PERPLEXITY', role: 'Deep Research' },
          ].map((model) => (
            <div
              key={model.name}
              className="flex flex-col items-center justify-center border-2 border-neutral-800 p-12 transition-colors hover:border-white hover:bg-neutral-900"
            >
              <div className="mb-4 text-4xl font-black">{model.name}</div>
              <div className="font-mono text-sm text-neutral-500">{model.role}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ManifestoSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black bg-cyan-400 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-16 lg:grid-cols-2">
          <div>
            <SectionHeading>The Architect's Manifesto</SectionHeading>
            <p className="mb-8 text-xl font-bold leading-relaxed">
              IntexuraOS is not just a personal operating system; it is a statement on software
              craftsmanship.
            </p>
            <p className="text-lg font-medium leading-relaxed">
              We reject "move fast and break things" in favor of "move deliberately and fix the root
              cause." It demonstrates that with the right abstractions, strict boundaries, and
              autonomous agents, a single Staff Engineer can maintain an enterprise-scale monorepo.
            </p>
          </div>

          <div className="grid gap-6">
            <BrutalistCard title="No Dummy Success" icon={Shield}>
              <p className="text-neutral-700">
                A function either succeeds with a verified result or fails explicitly. We never return{' '}
                <code className="bg-neutral-200 px-1 py-0.5 text-sm">null</code> to silence an
                error.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Hexagonal Architecture" icon={Layers}>
              <p className="text-neutral-700">
                Strict boundaries between Domain Logic and Infrastructure. Notion is just an adapter.
                The core logic is pure.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Continuity Ledger" icon={FileText}>
              <p className="text-neutral-700">
                Complex reasoning is persisted. We treat the process of solving a problem as valuable
                data, logged in immutable markdown ledgers.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Sleep-at-Night Reliability" icon={Zap}>
              <p className="text-neutral-700">
                95%+ coverage is not a target; it's a gate. If the code isn't proven to work, it
                doesn't merge.
              </p>
            </BrutalistCard>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="bg-white px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
        <div>
          <h3 className="mb-2 text-2xl font-black uppercase tracking-tighter">IntexuraOS</h3>
          <p className="font-mono text-sm text-neutral-500">
            © {new Date().getFullYear()} Piotr Buchman. Open Source.
          </p>
        </div>
        <div className="flex gap-8 font-mono text-sm font-bold uppercase">
          <a
            href="https://github.com/your-org/intexuraos"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            GitHub <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="https://linkedin.com/in/piotr-buchman"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            LinkedIn <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="mailto:piotr@buchman.io"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            Email <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

// --- Main Page ---

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-black selection:bg-cyan-300 selection:text-black">
      <HeroSection />
      <DemoSection />
      <CouncilSection />
      <ManifestoSection />
      <Footer />
    </div>
  );
}
