import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GithubIcon } from './BrandIcons.js';

export function Navbar(): React.JSX.Element {
  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 z-50 w-full border-b border-white/10 bg-white/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-cyan-600" />
          <span className="font-bold tracking-tight text-neutral-900">IntexuraOS</span>
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/pbuchman/intexuraos"
            className="hidden items-center gap-1 text-sm font-medium text-neutral-600 transition-colors hover:text-cyan-600 sm:flex"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon className="h-4 w-4" /> GitHub
          </a>
          <Link
            to="/login"
            className="rounded-full bg-black px-6 py-2 text-sm font-semibold text-white transition-transform hover:scale-105 hover:bg-neutral-800 active:scale-95"
          >
            Log In
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}
