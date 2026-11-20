"use client";

import type { ReactNode } from "react";

import { useStickToBottom } from "../hooks/useStickToBottom";
import { MicIcon, MicOffIcon, WaveIcon } from "../icons";
import { cx } from "../lib/cx";
import { IconButton, PillButton } from "../primitives/Button";
import { LiveBadge } from "../primitives/Pill";
import { useKitStrings } from "../strings";
import { TurnBubble, type TurnBubbleProps } from "./Transcript";
import type { Turn } from "./types";

export type CallControlsProps = {
  /** The call is connected. When false the mic is disabled and End reads Close. */
  live: boolean;
  micOn: boolean;
  onToggleMic: (on: boolean) => void;
  onEnd: () => void;
};

/** The mute button and End conversation, side by side. At the bottom of the panel and the dock. */
export function CallControls({ live, micOn, onToggleMic, onEnd }: CallControlsProps) {
  const s = useKitStrings();
  const on = live && micOn;
  return (
    <div className="flex items-center gap-3">
      <IconButton
        tone="violet"
        size="lg"
        label={on ? s.mute : s.unmute}
        aria-pressed={!on}
        disabled={!live}
        onClick={() => onToggleMic(!micOn)}
      >
        {on ? <MicIcon /> : <MicOffIcon />}
      </IconButton>
      <PillButton size="lg" icon={<WaveIcon />} onClick={onEnd}>
        {live ? s.endConversation : s.close}
      </PillButton>
    </div>
  );
}

export type PromptRailProps = {
  /** Things to say, in the UI's language, without quotes: "What's the deductible?" */
  prompts: string[];
  /** Send a prompt as if spoken (Pipecat's sendText). Without it, the prompts are plain text. */
  onPrompt?: (prompt: string) => void;
  className?: string;
};

/**
 * TRY ASKING and a row of quoted prompts that scrolls sideways, edge to edge of a violet surface
 * with p-6. Change the prompts with what's on screen: they teach the caller what the agent can do.
 */
export function PromptRail({ prompts, onPrompt, className = "mt-4 shrink-0 border-t border-white/25 pt-4" }: PromptRailProps) {
  const s = useKitStrings();
  if (!prompts.length) return null;
  const pill = "inline-block whitespace-nowrap rounded-full border border-white/30 bg-white/12 px-4 py-2 text-white";
  return (
    <div className={className}>
      <h3 className="label text-[0.65rem] text-white/80">{s.tryAsking}</h3>
      <ul className="-mx-6 mt-3 flex snap-x scroll-px-6 gap-2 overflow-x-auto px-6 pb-2 [scrollbar-color:rgb(255_255_255/0.35)_transparent] [scrollbar-width:thin]">
        {prompts.map((prompt) => (
          <li key={prompt} className="shrink-0 snap-start">
            {onPrompt ? (
              <button type="button" onClick={() => onPrompt(prompt)} className={cx(pill, "transition hover:bg-white/25")}>
                “{prompt}”
              </button>
            ) : (
              <span className={pill}>“{prompt}”</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type VoiceSessionPanelProps = CallControlsProps &
  Pick<TurnBubbleProps, "you" | "locale" | "onChip" | "shortNames"> & {
    turns: Turn[];
    /** Under the title in small type: "flux-general-en · en · 412 ms" (STT model, language, latency) */
    meta?: string;
    /** Settings are open mid-call, so the mic is off: the note says so */
    paused?: boolean;
    prompts?: string[];
    onPrompt?: (prompt: string) => void;
    /** Replaces the default note above the controls */
    note?: ReactNode;
    title?: string;
    className?: string;
  };

/**
 * The voice session: the live transcript with function calls, prompts to try, and the call
 * controls, on violet. It fills its parent's height, so give the parent one: beside the screen
 * on wide layouts (StageLayout and RecordLayout do this), or as a full-height sheet on phones.
 */
export function VoiceSessionPanel({
  turns,
  live,
  micOn,
  onToggleMic,
  onEnd,
  meta,
  paused = false,
  prompts = [],
  onPrompt,
  note,
  title,
  you,
  locale,
  onChip,
  shortNames,
  className,
}: VoiceSessionPanelProps) {
  const s = useKitStrings();
  const list = useStickToBottom<HTMLOListElement>();

  return (
    <section
      aria-label={title ?? s.sessionTitle}
      className={cx("flex h-full min-h-0 flex-col rounded-panel bg-violet p-6 text-white", className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title ?? s.sessionTitle}</h2>
          {meta && <p className="mt-2 text-sm text-white/85 tabular-nums">{meta}</p>}
        </div>
        <LiveBadge live={live} />
      </header>

      <ol ref={list} className="-mr-2 mt-5 min-h-40 flex-1 space-y-5 overflow-y-auto pr-2" aria-live="polite">
        {turns.map((turn) => (
          <TurnBubble key={turn.id} turn={turn} you={you} locale={locale} onChip={onChip} shortNames={shortNames} />
        ))}
      </ol>

      <PromptRail prompts={prompts} onPrompt={onPrompt} />

      <footer className="mt-4">
        <p className="flex items-start gap-2 text-[0.95rem] leading-snug text-white/90">
          <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", live && !paused ? "bg-white" : "bg-white/40")} aria-hidden="true" />
          {note ?? (paused ? s.pausedNote : live ? s.liveNote : s.endedNote)}
        </p>
        <div className="mt-4">
          <CallControls live={live} micOn={micOn} onToggleMic={onToggleMic} onEnd={onEnd} />
        </div>
      </footer>
    </section>
  );
}

/** Bottom padding a page needs so its last content clears the SessionDock */
export const DOCK_CLEARANCE = "pb-56";

export type SessionDockProps = CallControlsProps & {
  prompts?: string[];
  onPrompt?: (prompt: string) => void;
  /** A row above the prompts, such as the caption that opens the transcript sheet */
  children?: ReactNode;
  className?: string;
};

/**
 * Phones and tablets have no room for the panel, so its prompts and controls dock at the bottom
 * on violet. Pad the page by DOCK_CLEARANCE. Hide it from lg up (className="lg:hidden") when
 * the panel shows there.
 */
export function SessionDock({ prompts = [], onPrompt, children, className, ...controls }: SessionDockProps) {
  return (
    <div className={cx("fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-violet px-6 pt-4 pb-4 text-white", className)}>
      {children && <div className="mb-3">{children}</div>}
      <PromptRail prompts={prompts} onPrompt={onPrompt} className="mb-2" />
      <CallControls {...controls} />
    </div>
  );
}

/** The dock's top row on a record screen: a live dot and the caption; press it to open the transcript. */
export function DockCaption({ text, live, onOpen }: { text?: string; live: boolean; onOpen: () => void }) {
  const s = useKitStrings();
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left" aria-label={s.openConversation}>
      <span className={cx("size-2.5 shrink-0 rounded-full", live ? "bg-lime" : "bg-white/40")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{text ? `“${text}”` : s.dockLive}</span>
      <span className="label text-[0.65rem] text-white/80">{s.transcript}</span>
    </button>
  );
}
