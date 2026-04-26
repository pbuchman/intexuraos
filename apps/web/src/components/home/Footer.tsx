import React from 'react';
import { GithubIcon, LinkedinIcon } from './BrandIcons.js';

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-neutral-100 bg-white px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-cyan-600" />
          <span className="font-bold text-neutral-900">IntexuraOS</span>
          <span className="text-xs text-neutral-400">v3.6.0</span>
        </div>
        <p className="text-sm text-neutral-500">
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://pbuchman.com" className="transition-colors hover:text-cyan-600">
            Piotr Buchman
          </a>
        </p>
        <div className="flex gap-6">
          <a
            href="https://github.com/pbuchman"
            className="text-neutral-400 transition-colors hover:text-neutral-900"
          >
            <GithubIcon className="h-5 w-5" />
          </a>
          <a
            href="https://linkedin.com/in/piotrbuchman"
            className="text-neutral-400 transition-colors hover:text-neutral-900"
          >
            <LinkedinIcon className="h-5 w-5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
