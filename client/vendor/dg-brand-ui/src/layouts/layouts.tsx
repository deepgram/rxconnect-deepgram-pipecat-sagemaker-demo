"use client";

import { type ReactNode, useState } from "react";

import { LockIcon } from "../icons";
import { cx } from "../lib/cx";
import { useKitStrings } from "../strings";

/**
 * The three screens every voice agent app is made of:
 *
 *   HeroLanding  — before the call: a photo, what the app does, and Start.
 *   StageLayout  — during the call, before there's a record: the dark violet stage with the
 *                  ring and caption, and the session panel beside it (or the dock on phones).
 *   RecordLayout — a record is open: the light paper page with the session panel kept beside
 *                  it (or the dock and a transcript sheet on phones).
 *
 * They lay things out and nothing more: pass the kit's components into their slots.
 */

export type HeroLandingProps = {
  /**
   * The hero photo: full-bleed on desktop, the top 46% on phones. A scene from the app's world
   * where you can hear the voice (the brand's photography rule). Leave it out and the landing is
   * flat Off-black: no gradient stands in for a photo.
   */
  image?: { src: string; alt: string; /** object-position on phones, where the photo is cropped */ position?: string };
  /** Top left: a Wordmark variant="pill" */
  brand: ReactNode;
  /** Top right: SettingsButton */
  actions?: ReactNode;
  /** Above the kicker: a SegmentedControl to pick who's calling */
  toggle?: ReactNode;
  /** Letter-spaced, above the title: "Let’s sort out your order" */
  kicker: string;
  /** Six words or fewer, ending in a period: "Track your order by voice." */
  title: string;
  /** One or two sentences: what to say, and what happens */
  intro: string;
  /** A Notice tone="error" or "info", over the button */
  notice?: ReactNode;
  /** The CtaButton size="lg" with a MicIcon */
  cta: ReactNode;
  /** Under the button, muted: "Talk naturally. We’ll ask for microphone access." */
  note?: string;
  /** PartnerLogos */
  footer?: ReactNode;
};

/** The landing screen: before the call starts. */
export function HeroLanding({ image, brand, actions, toggle, kicker, title, intro, notice, cta, note, footer }: HeroLandingProps) {
  return (
    <main className="relative flex min-h-dvh flex-col bg-ink text-white">
      {image ? (
        <div className="relative h-[46dvh] min-h-72 w-full lg:absolute lg:inset-0 lg:h-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.alt}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover lg:object-center"
            style={{ objectPosition: image.position }}
          />
          <div className="photo-scrim absolute inset-0" />
        </div>
      ) : (
        // No photo: flat Off-black, with room for the header on phones
        <div className="h-32 lg:hidden" aria-hidden="true" />
      )}

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5 sm:p-8">
        {brand}
        {actions}
      </header>

      <div className="relative z-10 -mt-6 flex w-full flex-1 flex-col items-center px-5 pb-6 text-center sm:px-8 lg:mx-auto lg:mt-0 lg:max-w-xl lg:justify-center lg:px-0 lg:pt-28">
        {toggle}
        <p className={cx("label text-white/80", toggle ? "mt-6" : "")}>{kicker}</p>
        <h1 className="mt-4 text-[2.6rem] leading-[1.05] font-semibold tracking-tight sm:text-5xl lg:text-6xl">{title}</h1>
        <p className="mt-5 text-lg leading-relaxed text-white/85">{intro}</p>

        <div className="mt-auto w-full pt-10 lg:mt-10">
          {notice && <div className="mb-4">{notice}</div>}
          {cta}
          {note && <p className="mt-3 text-center text-white/70">{note}</p>}
          {footer && <div className="mt-6 border-t border-white/15 pt-6 lg:hidden">{footer}</div>}
        </div>
      </div>

      {footer && <div className="relative z-10 hidden px-16 pb-10 lg:block">{footer}</div>}
    </main>
  );
}

export type StageLayoutProps = {
  /** Top left: a Wordmark variant="plain" */
  brand: ReactNode;
  /** Top right: LockPill tone="dark", SettingsButton */
  actions?: ReactNode;
  /** The stage: VoiceRing, CallStatus, LiveCaption, then a FoundCard or ResultCards */
  children: ReactNode;
  /** The VoiceSessionPanel, beside the stage from lg up */
  panel?: ReactNode;
  /** The SessionDock, at the bottom below lg */
  dock?: ReactNode;
  /** PartnerLogos, under a hairline at the bottom of the stage */
  footer?: ReactNode;
};

/** The dark stage: during the call, before a record opens, and for search results. */
export function StageLayout({ brand, actions, children, panel, dock, footer }: StageLayoutProps) {
  return (
    <main className="flex min-h-dvh bg-ink text-white">
      <div className={cx("stage-glow relative flex min-h-dvh flex-1 flex-col overflow-hidden px-5 pt-5 sm:px-8", dock ? "pb-56 lg:pb-6" : "pb-6")}>
        <header className="flex items-center justify-between gap-3">
          {brand}
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        {footer && <div className="mx-auto mt-6 w-full max-w-2xl border-t border-white/15 pt-6">{footer}</div>}
      </div>
      {panel && (
        <aside className="hidden w-[26rem] shrink-0 p-6 lg:block">
          <div className="sticky top-6 h-[calc(100dvh-3rem)] min-h-[34rem]">{panel}</div>
        </aside>
      )}
      {dock && <div className="lg:hidden">{dock}</div>}
    </main>
  );
}

/** A centered column on the stage for the ring, the status line, and the caption. */
export function StageCenter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto flex w-full max-w-2xl flex-1 flex-col items-center pt-8 text-center", className)}>{children}</div>;
}

export type RecordLayoutProps = {
  /** The TopBar */
  topBar: ReactNode;
  /** The record: PageHeader, ProgressStepper, HighlightBand, CardColumns of DataCards */
  children: ReactNode;
  /** The VoiceSessionPanel. Beside the record from lg up; in a full-screen sheet below that. */
  panel: ReactNode;
  /** Muted, with a lock, under the panel: what the caller can and can't do here */
  panelNote?: string;
  /** PartnerLogos, on an ink strip at the bottom */
  footer?: ReactNode;
  /**
   * The SessionDock for phones and tablets. Gets `openSheet`, for a DockCaption that opens the
   * transcript in a sheet.
   */
  dock?: (openSheet: () => void) => ReactNode;
};

/** The paper record page, with the voice session kept beside it. */
export function RecordLayout({ topBar, children, panel, panelNote, footer, dock }: RecordLayoutProps) {
  const [sheet, setSheet] = useState(false);
  const s = useKitStrings();
  return (
    <div className="min-h-dvh bg-paper text-fg">
      {topBar}

      <div className="mx-auto grid max-w-[100rem] gap-8 px-5 pt-8 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_24rem] xl:px-12">
        <main className="min-w-0 space-y-7">{children}</main>
        <aside className="hidden space-y-5 lg:block">
          <div className="sticky top-24 flex h-[calc(100dvh-7.5rem)] min-h-[40rem] flex-col gap-5">
            <div className="min-h-[34rem] flex-1">{panel}</div>
            {panelNote && <AsideNote>{panelNote}</AsideNote>}
          </div>
        </aside>
      </div>

      {footer && <footer className={cx("bg-ink pt-10", dock ? "pb-66 lg:pb-10" : "pb-10")}>{footer}</footer>}

      {dock && <div className="lg:hidden">{dock(() => setSheet(true))}</div>}
      {sheet && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-ink/60 p-3 pt-16 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label={s.conversation}>
          <button type="button" onClick={() => setSheet(false)} className="label absolute top-4 right-4 rounded-full bg-white px-4 py-2 text-ink">
            {s.close}
          </button>
          {panel}
        </div>
      )}
    </div>
  );
}

/** A muted note with a lock, on paper: under the session panel. */
export function AsideNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-3 px-1 text-muted">
      <LockIcon className="mt-1 size-4 shrink-0" />
      {children}
    </p>
  );
}
