'use client';

/**
 * Which screen shows when (the kit's new-app screen flow):
 *   before the call  → landing
 *   on the call      → the stage (CallScreen)
 *   an order found   → the record on wide screens; a FoundCard on the stage first on phones
 *
 * In development, ?screen=landing|listening|found|review renders a screen from fixtures, no call.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FocusProvider, WIDE, useFocus, useMediaQuery, useSimulatedLevel } from '@deepgram-devs/dg-brand-ui';

import { initialAgentView, type AgentView } from '@/voice/agentTurns';
import { SAMPLE_ORDER, rxconnect } from '@/voice/example';
import { toRecordView } from '@/voice/record';
import { fetchOrders, pickAnotherOrder, pickRandomOrder, stepsFor } from '@/voice/sampleSteps';
import type { Order } from '@/voice/order';

import { AboutDrawer } from '../screens/AboutDrawer';
import { CallScreen } from '../screens/CallScreen';
import { LandingScreen } from '../screens/LandingScreen';
import { RecordScreen } from '../screens/RecordScreen';
import type { Call } from '../screens/session';
import { useVoiceConnection } from './useVoiceConnection';

type Screen = 'landing' | 'listening' | 'found' | 'review';
const SCREENS: Screen[] = ['landing', 'listening', 'found', 'review'];

/** ?screen=… in development: which screen to show from fixtures */
function useFixtureScreen(): Screen | null {
  const [screen, setScreen] = useState<Screen | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const wanted = new URLSearchParams(window.location.search).get('screen');
    setScreen(SCREENS.find((s) => s === wanted) ?? null);
  }, []);
  return screen;
}

function fixtureView(screen: Screen): AgentView {
  const turns = screen === 'listening' ? rxconnect.conversation.lookup : rxconnect.conversation.record;
  const lastCaller = [...turns].reverse().find((t) => t.role === 'user');
  return {
    ...initialAgentView,
    turns,
    caption: { text: lastCaller?.text ?? '', live: lastCaller?.final === false },
    order: screen === 'listening' ? null : SAMPLE_ORDER,
    latencyMs: 412,
  };
}

export const App = () => {
  const connection = useVoiceConnection();
  const { isConnected, isMuted, status, error, view, levelRef, connect, disconnect, toggleMute, sendText } = connection;
  const fixture = useFixtureScreen();
  const simulatedLevel = useSimulatedLevel(fixture !== null);
  const wide = useMediaQuery(WIDE);
  const [details, setDetails] = useState(false);
  const [about, setAbout] = useState(false);
  // The drawer pauses the mic mid-call, and gives it back on close only if it took it
  const pausedMic = useRef(false);
  const openAbout = () => {
    if (isConnected && !isMuted) {
      pausedMic.current = true;
      toggleMute();
    }
    setAbout(true);
  };
  const closeAbout = () => {
    if (pausedMic.current && isConnected && isMuted) toggleMute();
    pausedMic.current = false;
    setAbout(false);
  };

  // A new call starts on the stage, not on the last call's record
  useEffect(() => {
    if (!isConnected) setDetails(false);
  }, [isConnected]);

  // Each call loads the sample members, and picks one at random with the steps to retrieve it
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [sample, setSample] = useState<Order | null>(null);
  const wantOrders = isConnected || fixture !== null;
  useEffect(() => {
    if (!wantOrders) {
      setSample(null);
      return;
    }
    const abort = new AbortController();
    fetchOrders(abort.signal)
      .then((list) => {
        setOrders(list);
        // Fixtures start from the sample order, so screenshots stay the same
        setSample(fixture ? SAMPLE_ORDER : pickRandomOrder(list));
      })
      .catch((e) => {
        if (!abort.signal.aborted) console.error('Could not load the sample members:', e);
      });
    return () => abort.abort();
  }, [wantOrders]);
  const sampleOrder = sample ?? (fixture ? SAMPLE_ORDER : null);
  const anotherSample = () => {
    if (orders?.length) setSample(pickAnotherOrder(orders, sampleOrder));
  };
  const steps = useMemo(() => (sampleOrder ? stepsFor(sampleOrder) : null), [sampleOrder]);

  const callView = fixture ? fixtureView(fixture) : view;
  const live = fixture ? true : isConnected;
  const record = useMemo(() => (callView.order ? toRecordView(callView.order) : null), [callView.order]);

  const call: Call = {
    view: callView,
    levelRef: fixture ? simulatedLevel : levelRef,
    live,
    micOn: fixture ? true : !isMuted || pausedMic.current,
    paused: about && live,
    onToggleMic: fixture ? () => {} : toggleMute,
    onEnd: fixture ? () => {} : disconnect,
    onOpenAbout: openAbout,
    onPrompt: fixture ? () => {} : sendText,
  };

  const screen: Screen = fixture ?? (!live ? 'landing' : !record ? 'listening' : wide || details ? 'review' : 'found');

  return (
    <>
      {screen === 'landing' ? (
        <LandingScreen
          connecting={!fixture && status === 'Connecting...'}
          error={fixture ? null : friendlyError(error)}
          aboutOpen={about}
          onStart={connect}
          onOpenAbout={openAbout}
        />
      ) : (
        <FocusProvider>
          <PointFromCalls focus={callView.focus} />
          {screen === 'review' && record ? (
            <RecordScreen call={call} record={record} />
          ) : (
            <CallScreen call={call} record={screen === 'listening' ? null : record} steps={steps} members={orders ?? (fixture ? [SAMPLE_ORDER] : null)} suggested={sampleOrder} onAnotherSample={anotherSample} onOpenRecord={() => setDetails(true)} />
          )}
        </FocusProvider>
      )}
      {about && <AboutDrawer onClose={closeAbout} />}
    </>
  );
};

/** The agent points at a card when a function call about it completes (FOCUS_FOR in agentTurns.ts) */
function PointFromCalls({ focus }: { focus: AgentView['focus'] }) {
  const { pointAt } = useFocus();
  useEffect(() => {
    if (focus) pointAt(focus.ids);
  }, [focus, pointAt]);
  return null;
}

/** The transport's errors, in the kit's words (docs/copy.md): what happened, and what to do */
function friendlyError(error: string | null): string | null {
  if (!error) return null;
  if (/microphone|NotAllowed|Permission/i.test(error)) return 'We couldn’t use your microphone. Allow microphone access, then start again.';
  if (/Token request failed|Connection failed|Connection error/i.test(error))
    return 'We couldn’t reach the voice agent. Start the server with python main.py in server/, then try again.';
  return error;
}
