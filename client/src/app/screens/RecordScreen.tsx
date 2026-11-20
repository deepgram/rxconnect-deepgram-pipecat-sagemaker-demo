'use client';

/** An order is open (kit template RecordScreen): the paper record, the session beside it. */
import { useEffect, useRef, type RefObject } from 'react';
import {
  Avatar,
  CaptionBar,
  DockCaption,
  PartnerLogos,
  RecordBody,
  RecordLayout,
  SettingsButton,
  TopBar,
  Wordmark,
  type RecordView,
} from '@deepgram-devs/dg-brand-ui';

import { rxconnect } from '@/voice/example';

import { Dock, Panel, persona, type Call } from './session';

export function RecordScreen({ call, record }: { call: Call; record: RecordView }) {
  const caption = call.view.caption;
  const state = !call.live ? 'ended' : call.paused || !call.micOn ? 'paused' : 'live';
  return (
    <RecordLayout
      topBar={
        <TopBar
          brand={<Wordmark variant="stacked" mark={rxconnect.brand.mark} name={rxconnect.brand.name} tagline={rxconnect.brand.tagline} />}
          center={<CaptionBar state={state} text={caption.text} meter={<LevelMeter level={call.levelRef} />} />}
          actions={
            <>
              <span className="hidden text-sm text-white/80 xl:inline">Voice AI by Deepgram</span>
              <SettingsButton tone="solid" open={call.paused} onClick={call.onOpenAbout} />
              <Avatar text={rxconnect.you} tone="violet" size="md" />
            </>
          }
        />
      }
      panel={<Panel call={call} prompts={rxconnect.recordPrompts} />}
      panelNote={persona.note}
      footer={<PartnerLogos />}
      dock={(openSheet) => (
        <Dock call={call} prompts={rxconnect.recordPrompts}>
          <DockCaption live={call.live} text={caption.text} onOpen={openSheet} />
        </Dock>
      )}
    >
      <RecordBody record={record} />
    </RecordLayout>
  );
}

/** Seven magenta bars that follow the call's level (the template's stand-in for a visualizer) */
function LevelMeter({ level }: { level: RefObject<number> }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const shape = [0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.3];
    let frame = 0;
    const tick = () => {
      const l = Math.max(0.15, level.current ?? 0);
      bars.current.forEach((bar, i) => {
        if (bar) bar.style.height = `${Math.round(4 + 18 * shape[i] * l)}px`;
      });
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <span className="flex h-6 w-14 shrink-0 items-center justify-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span key={i} ref={(el) => void (bars.current[i] = el)} className="w-[3px] rounded-full bg-magenta" style={{ height: 6 }} />
      ))}
    </span>
  );
}
