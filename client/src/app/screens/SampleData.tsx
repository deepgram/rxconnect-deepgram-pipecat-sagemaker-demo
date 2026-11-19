'use client';

/**
 * The sample data on the call screen, in the old Data Browser's three views (orders,
 * prescriptions, members) as the kit's stage cards. A column on the left from md up; a sideways
 * row on phones. Selecting a card says that row's member ID for the caller.
 */
import { ResultCard, SegmentedControl, cx } from '@deepgram-devs/dg-brand-ui';

import type { Order } from '@/voice/order';
import { orderTone } from '@/voice/record';
import { SAMPLE_VIEWS, cardFor, sampleRows, type SampleView } from '@/voice/sampleData';

export function SampleData({
  orders,
  suggested,
  view,
  onViewChange,
  onSay,
  layout,
}: {
  orders: Order[];
  /** This call's random member: their rows come first */
  suggested: Order | null;
  view: SampleView;
  onViewChange: (view: SampleView) => void;
  onSay: (memberId: string) => void;
  layout: 'column' | 'row';
}) {
  const rows = sampleRows(view, orders, suggested?.member_id);
  const column = layout === 'column';
  const headingId = `sample-data-${layout}`;
  return (
    <section aria-labelledby={headingId} className={cx('flex min-h-0 flex-col', column ? 'h-full' : 'w-full')}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="label text-white/90">
          Sample data
        </h2>
        <span className="label text-white/60">
          {rows.length} {SAMPLE_VIEWS.find((v) => v.value === view)?.label.toLowerCase()}
        </span>
      </div>
      <SegmentedControl
        className="mt-3"
        label="Sample data view"
        tone="glass"
        kind="tab"
        options={SAMPLE_VIEWS}
        value={view}
        onChange={onViewChange}
      />
      <p className="mt-3 text-sm text-white/70">
        Say “My member ID is {suggested?.member_id ?? 'M1001'}”, or any member ID below.
      </p>
      <ul
        className={cx(
          'mt-4 min-h-0',
          column
            ? 'flex-1 space-y-3 overflow-y-auto pr-1 pb-10 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]'
            : 'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3',
        )}
      >
        {rows.map((row) => {
          const suggestedRow = suggested?.member_id === row.memberId;
          return (
            <li key={row.key} className={column ? undefined : 'w-64 shrink-0 snap-start'}>
              <ResultCard
                {...cardFor(view, row)}
                status={row.status ? { label: row.status, tone: orderTone(row.status) } : undefined}
                actionLabel={`${suggestedRow ? 'Suggested · ' : ''}Say ${row.memberId}`}
                onOpen={() => onSay(row.memberId)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
