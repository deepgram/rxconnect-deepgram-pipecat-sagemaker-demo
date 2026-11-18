'use client';

/** Before the call (kit template LandingScreen): flat Off-black, one persona, one call to action. */
import { CtaButton, HeroLanding, MicIcon, Notice, PartnerLogos, SettingsButton, Wordmark } from '@deepgram-devs/dg-brand-ui';

import { rxconnect } from '@/voice/example';

import { persona } from './session';

export function LandingScreen({
  connecting,
  error,
  aboutOpen,
  onStart,
  onOpenAbout,
}: {
  connecting: boolean;
  error: string | null;
  aboutOpen: boolean;
  onStart: () => void;
  onOpenAbout: () => void;
}) {
  return (
    <HeroLanding
      image={rxconnect.hero}
      brand={<Wordmark variant="pill" mark={rxconnect.brand.mark} name={rxconnect.brand.name} />}
      actions={<SettingsButton open={aboutOpen} onClick={onOpenAbout} />}
      kicker={persona.kicker}
      title={persona.title}
      intro={persona.intro}
      notice={error ? <Notice tone="error">{error}</Notice> : undefined}
      cta={
        <CtaButton icon={<MicIcon />} busy={connecting} onClick={onStart}>
          {connecting ? 'Connecting…' : 'Start conversation'}
        </CtaButton>
      }
      note="Talk naturally. We’ll ask for microphone access. Need a member ID? Open the gear, then Data."
      footer={<PartnerLogos />}
    />
  );
}
