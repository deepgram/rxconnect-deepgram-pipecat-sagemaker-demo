'use client';

/**
 * On the call, before the record opens: the dark stage with the voice ring (kit template
 * ListeningScreen). On phones and tablets a found order shows as a FoundCard first.
 */
import { useState } from 'react';
import {
  CallStatus,
  FoundCard,
  IconButton,
  LiveCaption,
  LockPill,
  PartnerLogos,
  SettingsButton,
  StageCenter,
  StageLayout,
  VoiceRing,
  Wordmark,
  foundCardFor,
  type RecordView,
} from '@deepgram-devs/dg-brand-ui';

import { rxconnect } from '@/voice/example';
import type { Order } from '@/voice/order';
import type { SampleView } from '@/voice/sampleData';
import type { SayStep } from '@/voice/sampleSteps';

import { ShuffleIcon } from './icons';
import { SampleGrid } from './SampleGrid';
import { Dock, Panel, persona, statusText, type Call } from './session';

export function CallScreen({
  call,
  record,
  steps,
  members,
  suggested,
  onAnotherSample,
  onOpenRecord,
}: {
  call: Call;
  record: RecordView | null;
  /** What to say to retrieve this call's sample order, until the agent finds one */
  steps: SayStep[] | null;
  /** The sample members to try, until the agent finds an order */
  members: Order[] | null;
  /** This call's random member */
  suggested: Order | null;
  /** Pick a different random member for the steps */
  onAnotherSample: () => void;
  onOpenRecord: () => void;
}) {
  const status = statusText(call);
  const prompts = record ? rxconnect.recordPrompts : steps ? steps.map((s) => s.phrase.replace(/\.$/, '')) : persona.prompts;
  const showMembers = !record && !!members?.length;
  const sayId = (memberId: string) => call.onPrompt(`My member ID is ${memberId}`);
  // One view for both layouts, so resizing keeps the tab
  const [view, setView] = useState<SampleView>('orders');
  const sampleProps = { orders: members ?? [], suggested, view, onViewChange: setView, onSay: sayId };
  return (
    <StageLayout
      brand={<Wordmark mark={rxconnect.brand.mark} name={rxconnect.brand.name} />}
      actions={
        <>
          <LockPill tone="dark" />
          <SettingsButton open={call.paused} onClick={call.onOpenAbout} />
        </>
      }
      panel={<Panel call={call} prompts={prompts} />}
      dock={<Dock call={call} prompts={prompts} />}
      footer={<PartnerLogos />}
    >
      <div className="flex flex-1 gap-8">
        {showMembers && (
          <aside className="mt-8 hidden w-[35rem] shrink-0 min-[1440px]:block min-[1440px]:h-[calc(100dvh-8rem)]">
            {/* 35rem: the Prescriptions grid's columns, a "Ready for pickup" pill, and the row arrow need
                about 530px. Only from 1440px is there room for that beside the orb. */}
            <SampleGrid {...sampleProps} layout="side" />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <StageCenter>
            <VoiceRing state={call.view.state} level={call.levelRef} paused={call.paused || !call.micOn} />
            <CallStatus className="mt-6" busy={status.busy}>
              {status.text}
            </CallStatus>
            <div className="mt-5 min-h-28" aria-live="polite">
              <LiveCaption text={call.view.caption.text} live={call.view.caption.live} placeholder={persona.caption} />
            </div>
            {!record && steps && <SaySteps steps={steps} onAnother={onAnotherSample} />}
            {showMembers && (
              <div className="mt-8 w-full min-[1440px]:hidden">
                <SampleGrid {...sampleProps} layout="below" />
              </div>
            )}
          </StageCenter>
          {record && (
            <div className="mx-auto mt-6 w-full max-w-2xl">
              <FoundCard
                {...foundCardFor(record, {
                  kicker: rxconnect.found.kicker,
                  action: { label: rxconnect.found.action, onClick: onOpenRecord },
                })}
              />
            </div>
          )}
        </div>
      </div>
    </StageLayout>
  );
}

/** The steps to retrieve the sample order: numbered, with what to say in curly quotes */
function SaySteps({ steps, onAnother }: { steps: SayStep[]; onAnother: () => void }) {
  return (
    <section className="glass mt-6 w-full max-w-md rounded-3xl p-6 text-left text-white" aria-labelledby="say-steps">
      <div className="flex items-center justify-between gap-3">
        <h2 id="say-steps" className="label text-white/70">
          Find a sample order
        </h2>
        <IconButton label="Pick another sample order" onClick={onAnother} className="-my-2 -mr-2">
          <ShuffleIcon />
        </IconButton>
      </div>
      {/* Announced when the button picks another member. The live region stays mounted; the list
          inside is keyed by the steps, so it remounts and the kit's rise plays once to show it's new. */}
      <div aria-live="polite">
        <ol key={steps.map((s) => s.phrase).join('|')} className="mt-4 animate-rise space-y-4">
          {steps.map((step, i) => (
            <li key={step.phrase} className="flex items-start gap-3">
              <span className="label flex size-7 shrink-0 items-center justify-center rounded-full border border-white/30" aria-hidden="true">
                {i + 1}
              </span>
              <p className="text-lg leading-snug">
                <span className="text-white/70">{step.lead} </span>“{step.phrase}”
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
