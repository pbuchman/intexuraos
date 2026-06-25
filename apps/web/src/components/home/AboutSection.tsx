import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { GithubIcon, LinkedinIcon } from './BrandIcons.js';

export function AboutSection(): React.JSX.Element {
  return (
    <section className="bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 text-4xl font-bold tracking-tight md:text-5xl">
          One developer.{' '}
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
            Zero excuses.
          </span>
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-neutral-400">
          IntexuraOS is what happens when one engineer treats agents as infrastructure, not demos.
          It is a working personal product and an engineering artifact at the same time: distributed
          system, agent platform, execution harness, and portfolio proof in one codebase.
        </p>
        <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-neutral-500">
          The point is not that one person did everything manually. The point is that the system
          captures intent, routes it to safe specialist agents, verifies the result, and leaves a trail
          that another engineer can inspect.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://www.linkedin.com/in/piotrbuchman/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <LinkedinIcon className="h-4 w-4" /> Piotr Buchman
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <GithubIcon className="h-4 w-4" /> Source Code
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <ArrowRight className="h-4 w-4" /> Changelog
          </a>
        </div>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-cyan-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition-all hover:-translate-y-0.5 hover:bg-cyan-700"
        >
          Get Started <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
