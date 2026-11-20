/**
 * The adapter: RxConnect's own socket messages (server/services/serializer.py) and its audio
 * player's events, reduced to the kit's shapes. The transport in useVoiceConnection is unchanged;
 * it dispatches every message here.
 */
import type { Caption, Turn, TurnChip, TurnState } from '@deepgram-devs/dg-brand-ui';

import type { Order } from './order';

export type AgentView = {
  turns: Turn[];
  caption: Caption;
  state: TurnState;
  /** The order the agent found (record-loaded), or null before it finds one */
  order: Order | null;
  /** Cards to light: set when a function call about them completes. nonce changes every time. */
  focus: { ids: string[]; nonce: number } | null;
  /** From the caller's last words to the agent's first audio */
  latencyMs?: number;
  /** When the caller's last words arrived, until the agent answers */
  userAt?: number;
  /** Chips waiting for the next assistant turn: the cards the last function calls were about */
  pendingChips: TurnChip[];
};

export const initialAgentView: AgentView = {
  turns: [],
  caption: { text: '', live: false },
  state: 'listening',
  order: null,
  focus: null,
  pendingChips: [],
};

/** Server messages, plus the app's own events from its audio player and controls. */
export type AgentEvent =
  | { type: 'transcript'; text: string; speaker: 'user' | 'assistant' }
  | {
      type: 'function-call';
      id: string;
      name: string;
      args?: Record<string, unknown>;
      status: 'running' | 'completed';
      ms?: number;
    }
  | { type: 'record-loaded'; order: Order }
  | { type: 'PlaybackStarted' | 'PlaybackEnded' | 'reset' }
  // Handled by the transport itself (audio, status, error, pong, clear): no change here
  | { type: 'audio' | 'status' | 'error' | 'disconnect' | 'pong' | 'clear' };

/**
 * Which record card each function is about: the agent "points" at it when the call completes.
 * The ids are the section ids in record.ts ("summary" is the HighlightBand).
 */
export const FOCUS_FOR: Record<string, TurnChip[]> = {
  list_member_orders: [{ id: 'summary', label: 'Order' }],
  lookup_order_status: [{ id: 'summary', label: 'Order' }],
  get_order_details: [{ id: 'medications', label: 'Medications' }],
  get_order_timing: [{ id: 'pickup', label: 'Pickup' }],
  get_order_refills: [{ id: 'refills', label: 'Refills' }],
};

export function agentReducer(view: AgentView, event: AgentEvent): AgentView {
  const at = new Date().toISOString();
  switch (event.type) {
    case 'transcript': {
      const text = event.text?.trim();
      if (!text) return view;
      if (event.speaker === 'user') {
        const turn: Turn = { id: `user:${view.turns.length}`, role: 'user', text, final: true, at };
        return {
          ...view,
          turns: [...view.turns, turn],
          caption: { text, live: false },
          state: 'thinking',
          userAt: Date.now(),
        };
      }
      // One answer can arrive as several messages: join them until someone else speaks
      const chips = view.pendingChips.length ? view.pendingChips : undefined;
      const last = view.turns.at(-1);
      if (last?.role === 'assistant') {
        const merged: Turn = { ...last, text: `${last.text} ${text}`, chips: chips ?? last.chips };
        return { ...view, turns: [...view.turns.slice(0, -1), merged], pendingChips: [] };
      }
      const turn: Turn = { id: `agent:${view.turns.length}`, role: 'assistant', text, final: true, at, chips };
      return { ...view, turns: [...view.turns, turn], pendingChips: [] };
    }
    case 'function-call': {
      if (event.status === 'running') {
        if (view.turns.some((t) => t.id === event.id)) return view;
        const turn: Turn = {
          id: event.id,
          role: 'tool',
          text: '',
          at,
          call: { name: event.name, args: event.args, status: 'running' },
        };
        return { ...view, turns: [...view.turns, turn], state: 'thinking' };
      }
      const turns = view.turns.map((t) =>
        t.id === event.id && t.call ? { ...t, call: { ...t.call, status: 'completed' as const, ms: event.ms } } : t,
      );
      const chips = FOCUS_FOR[event.name];
      if (!chips) return { ...view, turns };
      const pendingChips = [...view.pendingChips, ...chips.filter((c) => !view.pendingChips.some((p) => p.id === c.id))];
      return {
        ...view,
        turns,
        pendingChips,
        focus: { ids: chips.map((c) => c.id), nonce: (view.focus?.nonce ?? 0) + 1 },
      };
    }
    case 'record-loaded':
      return { ...view, order: event.order };
    case 'PlaybackStarted':
      return {
        ...view,
        state: 'speaking',
        latencyMs: view.userAt ? Date.now() - view.userAt : view.latencyMs,
        userAt: undefined,
      };
    case 'PlaybackEnded':
      return { ...view, state: 'listening' };
    case 'reset':
      return initialAgentView;
    default:
      return view;
  }
}
