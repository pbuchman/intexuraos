import React from 'react';
import { Navbar } from '@/components/home/Navbar.js';
import { HeroSection } from '@/components/home/HeroSection.js';
import { StatsSection } from '@/components/home/StatsSection.js';
import { VoiceSection } from '@/components/home/VoiceSection.js';
import { SelfBuildingSection } from '@/components/home/SelfBuildingSection.js';
import { CouncilSection } from '@/components/home/CouncilSection.js';
import { IntegrationsSection } from '@/components/home/IntegrationsSection.js';
import { WhatsNewSection } from '@/components/home/WhatsNewSection.js';
import { GettingStartedSection } from '@/components/home/GettingStartedSection.js';
import { LimitationsSection } from '@/components/home/LimitationsSection.js';
import { EngineeringSection } from '@/components/home/EngineeringSection.js';
import { AboutSection } from '@/components/home/AboutSection.js';
import { Footer } from '@/components/home/Footer.js';

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 selection:bg-cyan-100 selection:text-cyan-900">
      <Navbar />
      <HeroSection />
      <StatsSection />
      <VoiceSection />
      <SelfBuildingSection />
      <CouncilSection />
      <IntegrationsSection />
      <WhatsNewSection />
      <GettingStartedSection />
      <LimitationsSection />
      <EngineeringSection />
      <AboutSection />
      <Footer />
    </div>
  );
}
