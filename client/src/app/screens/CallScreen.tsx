'use client';

/**
 * On the call, before the record opens: the dark stage with the voice ring (kit template
 * ListeningScreen). On phones and tablets a found order shows as a FoundCard first.
 */
import {
  CallStatus,
  FoundCard,
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
import type { SayStep } from '@/voice/sampleSteps';

import { Dock, Panel, persona, statusText, type Call } from './session';

export function CallScreen({
  call,
  record,
  steps,
  onOpenRecord,
}: {
  call: Call;
  record: RecordView | null;
  /** What to say to retrieve this call's sample order, until the agent finds one */
  steps: SayStep[] | null;
  onOpenRecord: () => void;
}) {
  const status = statusText(call);
  const prompts = record ? rxconnect.recordPrompts : steps ? steps.map((s) => s.phrase.replace(/\.$/, '')) : persona.prompts;
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
      <StageCenter>
        <VoiceRing state={call.view.state} level={call.levelRef} paused={call.paused || !call.micOn} />
        <CallStatus className="mt-6" busy={status.busy}>
          {status.text}
        </CallStatus>
        <div className="mt-5 min-h-28" aria-live="polite">
          <LiveCaption text={call.view.caption.text} live={call.view.caption.live} placeholder={persona.caption} />
        </div>
        {!record && steps && <SaySteps steps={steps} />}
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
    </StageLayout>
  );
}

/** The steps to retrieve the sample order: numbered, with what to say in curly quotes */
function SaySteps({ steps }: { steps: SayStep[] }) {
  return (
    <section className="glass mt-6 w-full max-w-md rounded-3xl p-6 text-left text-white" aria-labelledby="say-steps">
      <h2 id="say-steps" className="label text-white/70">
        Find a sample order
      </h2>
      <ol className="mt-4 space-y-4">
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
    </section>
  );
}
