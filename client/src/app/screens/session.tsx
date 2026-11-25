'use client';

/** What every in-call screen shares: the call's state and handlers, the panel, and the dock. */
import type { ReactNode, RefObject } from 'react';
import { SessionDock, VoiceSessionPanel, useFocus, type TurnChip } from '@deepgram-devs/dg-brand-ui';

import type { AgentView } from '@/voice/agentTurns';
import { metaLine, rxconnect } from '@/voice/example';

export type Call = {
  view: AgentView;
  levelRef: RefObject<number>;
  live: boolean;
  micOn: boolean;
  /** The About drawer is open mid-call, so the mic is paused */
  paused: boolean;
  onToggleMic: () => void;
  onEnd: () => void;
  onOpenAbout: () => void;
  /** A clicked prompt, sent as if spoken */
  onPrompt: (prompt: string) => void;
};

export const persona = rxconnect.personas[0];

/** The words under the ring */
export function statusText(call: Call): { text: string; busy: boolean } {
  if (!call.live) return { text: 'Call ended', busy: false };
  if (call.paused) return { text: 'Paused', busy: false };
  if (!call.micOn) return { text: 'Muted', busy: false };
  if (call.view.state === 'thinking') return { text: 'Looking it up', busy: true };
  if (call.view.state === 'speaking') return { text: 'Speaking', busy: false };
  return { text: 'Listening', busy: false };
}

export function Panel({ call, prompts }: { call: Call; prompts: string[] }) {
  const { pointAt } = useFocus();
  return (
    <VoiceSessionPanel
      turns={call.view.turns}
      live={call.live}
      micOn={call.micOn}
      onToggleMic={() => call.onToggleMic()}
      onEnd={call.onEnd}
      paused={call.paused}
      meta={metaLine(call.view.latencyMs)}
      prompts={prompts}
      onPrompt={call.onPrompt}
      you={rxconnect.you}
      locale="en-US"
      shortNames={rxconnect.shortNames}
      onChip={(chip: TurnChip) => pointAt([chip.id])}
    />
  );
}

export function Dock({ call, prompts, children }: { call: Call; prompts: string[]; children?: ReactNode }) {
  return (
    <SessionDock live={call.live} micOn={call.micOn} onToggleMic={() => call.onToggleMic()} onEnd={call.onEnd} prompts={prompts} onPrompt={call.onPrompt}>
      {children}
    </SessionDock>
  );
}
