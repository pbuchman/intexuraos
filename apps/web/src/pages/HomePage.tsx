import { Link } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  Clock,
  Database,
  FileText,
  Image,
  Link as LinkIcon,
  Lock,
  MessageSquare,
  Mic,
  RefreshCw,
  Shield,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';

function HeroSection(): React.JSX.Element {
  const scrollToFeatures = (): void => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* Gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
        {/* Logo */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
              Intexura
            </span>
            <span className="text-white">OS</span>
          </h1>
        </div>

        {/* Main headline */}
        <h2 className="mb-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight text-white md:text-6xl lg:text-7xl">
          Your personal operating system{' '}
          <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">
            runs on Notion
          </span>
        </h2>

        {/* Sub-headline */}
        <p className="mb-10 max-w-2xl text-lg leading-relaxed text-slate-400 md:text-xl">
          Capture what you actually do: messages, voice, photos, signals and turn raw motion into
          structured, executable truth. No complicated apps. No technical dashboards. Just WhatsApp
          and Notion.
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <Link
            to="/login"
            className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-violet-600 to-cyan-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-violet-500/30"
          >
            <span className="relative z-10">Log in</span>
            <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          </Link>
          <button
            onClick={scrollToFeatures}
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/50 px-6 py-3 text-slate-300 backdrop-blur-sm transition-all duration-300 hover:border-slate-600 hover:bg-slate-800/50 hover:text-white"
          >
            See how it works
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <div className="flex h-10 w-6 items-start justify-center rounded-full border border-slate-700 p-2">
            <div className="h-2 w-1 animate-bounce rounded-full bg-slate-500" />
          </div>
        </div>
      </div>
    </section>
  );
}

function PrinciplesSection(): React.JSX.Element {
  const principles = [
    {
      title: 'Notion as Truth',
      description:
        "We don't ask what you plan to do. We watch what you actually do. Real actions become real data.",
    },
    {
      title: 'No Dummy Success',
      description:
        "Intentions don't count. Completed actions do. IntexuraOS tracks execution, not aspirations.",
    },
    {
      title: 'Impotent Operations',
      description:
        'Operations that produce no change produce no noise. Only meaningful signals surface.',
    },
  ];

  return (
    <section className="border-t border-slate-800 bg-slate-900 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {principles.map((principle) => (
            <div
              key={principle.title}
              className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 p-8 transition-all duration-300 hover:border-slate-700 hover:bg-slate-900/50"
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-violet-600/5 blur-2xl transition-all duration-500 group-hover:bg-violet-600/10" />
              <h3 className="relative mb-4 font-mono text-lg font-semibold tracking-tight text-white">
                {principle.title}
              </h3>
              <p className="relative text-sm leading-relaxed text-slate-400">
                {principle.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InputLayerSection(): React.JSX.Element {
  const features = [
    {
      icon: MessageSquare,
      title: 'Text Capture',
      description: "Send any message. It's stored, searchable, structured.",
    },
    {
      icon: Mic,
      title: 'Voice Notes',
      description: 'Speak. We transcribe. Automatic language detection.',
    },
    {
      icon: Image,
      title: 'Photo Capture',
      description: 'Send images. Thumbnails generated. Originals preserved.',
    },
    {
      icon: FileText,
      title: 'Lists & Tasks',
      description: 'Type a list. It becomes a list. No formatting required.',
    },
    {
      icon: LinkIcon,
      title: 'Links',
      description: 'Share a URL. Metadata extracted. Preview generated.',
    },
  ];

  return (
    <section id="features" className="bg-slate-950 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            WhatsApp is your{' '}
            <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
              command line
            </span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-slate-400">
            Forget apps. Forget switching contexts. IntexuraOS receives everything through
            WhatsApp—the interface you already live in.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-slate-800 bg-slate-900/30 p-6 transition-all duration-300 hover:border-emerald-500/30 hover:bg-slate-900/50"
            >
              <feature.icon className="mb-4 h-8 w-8 text-emerald-400 transition-transform duration-300 group-hover:scale-110" />
              <h3 className="mb-2 font-semibold text-white">{feature.title}</h3>
              <p className="text-sm text-slate-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignalLayerSection(): React.JSX.Element {
  const capabilities = [
    {
      icon: Wallet,
      title: 'Financial Signals',
      description: 'Track spending from banking app notifications.',
    },
    {
      icon: Users,
      title: 'Group Chat Summaries',
      description: 'Extract key messages from noisy group chats.',
    },
    {
      icon: Bell,
      title: 'App Activity',
      description: "See which apps demand your attention - and which don't.",
    },
    {
      icon: Smartphone,
      title: 'Device Tracking',
      description: 'Monitor signals across multiple devices.',
    },
  ];

  return (
    <section className="relative overflow-hidden border-t border-slate-800 bg-slate-900 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute right-0 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-orange-500/5 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-16 max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Your phone already knows everything.{' '}
            <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
              We just listen.
            </span>
          </h2>
          <p className="text-lg text-slate-400">
            IntexuraOS captures notifications from your mobile device—banking alerts, group chat
            summaries, delivery updates —and extracts the signals that matter.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="group flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-5 transition-all duration-300 hover:border-orange-500/30"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
                <cap.icon className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-white">{cap.title}</h3>
                <p className="text-sm text-slate-400">{cap.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StructureLayerSection(): React.JSX.Element {
  const capabilities = [
    {
      icon: Sparkles,
      title: 'Prompt Development',
      description: 'Build and refine prompts for any AI system.',
    },
    {
      icon: RefreshCw,
      title: 'Iterative Refinement',
      description: 'Each pass sharpens your thinking.',
    },
    {
      icon: FileText,
      title: 'Structured Output',
      description: 'Transform scattered notes into actionable frameworks.',
    },
    {
      icon: Database,
      title: 'Vault Storage',
      description: 'All prompts saved in your Notion workspace.',
    },
  ];

  return (
    <section className="relative overflow-hidden bg-slate-950 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute left-0 top-1/3 h-80 w-80 rounded-full bg-fuchsia-500/5 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Raw thoughts become{' '}
            <span className="bg-gradient-to-r from-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
              refined structures
            </span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-slate-400">
            IntexuraOS includes Prompt Vault GPT - a custom AI model for iterative thinking. Feed it
            raw ideas. Get back structured prompts, refined questions, and executable frameworks.
          </p>
          <p className="mt-4 font-mono text-sm text-slate-500">
            This isn&apos;t chat. It&apos;s structured cognition.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="group flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/30 p-5 transition-all duration-300 hover:border-fuchsia-500/30"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/10 to-violet-500/10">
                <cap.icon className="h-6 w-6 text-fuchsia-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">{cap.title}</h3>
                <p className="text-sm text-slate-400">{cap.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function IntegrationsSection(): React.JSX.Element {
  const integrations = [
    {
      name: 'WhatsApp',
      description: 'Your primary input channel. Send anything.',
      color: 'text-green-400',
    },
    {
      name: 'Notion',
      description: 'Your prompt vault and structured storage.',
      color: 'text-slate-300',
    },
    {
      name: 'Mobile (Tasker)',
      description: 'Capture notifications from Android devices.',
      color: 'text-cyan-400',
    },
    {
      name: 'Your Data',
      description: 'All data is yours. Stored securely. Exportable.',
      color: 'text-violet-400',
    },
  ];

  return (
    <section className="border-t border-slate-800 bg-slate-900 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Connects where you already work
          </h2>
          <p className="text-slate-400">
            IntexuraOS integrates with the tools you use — not the ones you should use.
          </p>
        </div>

        <div className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-2">
          {integrations.map((integration) => (
            <div
              key={integration.name}
              className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 transition-all duration-300 hover:border-slate-700"
            >
              <h3 className={`mb-2 text-lg font-semibold ${integration.color}`}>
                {integration.name}
              </h3>
              <p className="text-sm text-slate-400">{integration.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CharacteristicsSection(): React.JSX.Element {
  const characteristics = [
    { icon: Shield, text: 'Encrypted storage — Google Cloud infrastructure' },
    { icon: Zap, text: 'Background processing — Transcription and extraction happen async' },
    { icon: Clock, text: 'Signed URLs — Media access expires automatically' },
    { icon: Lock, text: 'User-owned data — Your data belongs to you' },
  ];

  return (
    <section className="bg-slate-950 py-16">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-8 text-center text-xl font-semibold text-slate-300">
          Built for reliability
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {characteristics.map((char) => (
            <div key={char.text} className="flex items-center gap-2 text-sm text-slate-500">
              <char.icon className="h-4 w-4" />
              <span>{char.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FooterCTASection(): React.JSX.Element {
  return (
    <section className="border-t border-slate-800 bg-slate-900 py-24">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">Start capturing.</h2>
        <p className="mb-8 text-lg text-slate-400">
          No setup wizards. No onboarding flows. Log in, connect WhatsApp, and go.
        </p>
        <Link
          to="/login"
          className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-violet-600 to-cyan-600 px-10 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-violet-500/30"
        >
          <span className="relative z-10">Log in</span>
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        </Link>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-800 bg-slate-950 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="text-lg font-bold">
          <span className="text-cyan-400">Intexura</span>
          <span className="text-white">OS</span>
        </div>
        <p className="text-sm text-slate-500">
          {String(currentYear)} IntexuraOS. All rights reserved.
        </p>
        <Link to="/login" className="text-sm text-slate-400 transition-colors hover:text-white">
          Log in
        </Link>
      </div>
    </footer>
  );
}

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950">
      <HeroSection />
      <PrinciplesSection />
      <InputLayerSection />
      <SignalLayerSection />
      <StructureLayerSection />
      <IntegrationsSection />
      <CharacteristicsSection />
      <FooterCTASection />
      <Footer />
    </div>
  );
}
