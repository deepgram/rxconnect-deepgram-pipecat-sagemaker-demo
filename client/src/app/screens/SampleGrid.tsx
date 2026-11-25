'use client';

/**
 * The sample data on the call screen as the kit's DataGrid in its stage tone, with the old Data
 * Browser's three views. Selecting a row says that row's member ID for the caller. Beside the orb
 * from 1440px; below the steps on narrower screens (where the grid turns into cards on phones).
 */
import { DataGrid, SegmentedControl, cx } from '@deepgram-devs/dg-brand-ui';

import type { Order } from '@/voice/order';
import { SAMPLE_VIEWS, sampleRows, type SampleView } from '@/voice/sampleData';

import { sampleColumns } from './sampleColumns';

const COLUMNS = sampleColumns('stage');

export function SampleGrid({
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
  layout: 'side' | 'below';
}) {
  const rows = sampleRows(view, orders, suggested?.member_id);
  const side = layout === 'side';
  const headingId = `sample-grid-${layout}`;
  return (
    <section aria-labelledby={headingId} className={cx('flex min-h-0 flex-col text-left', side ? 'h-full' : 'w-full')}>
      <h2 id={headingId} className="label text-white/90">
        Sample data
      </h2>
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
      <div
        className={cx(
          'mt-4 min-h-0 overflow-y-auto',
          side ? 'flex-1 pb-10 [mask-image:linear-gradient(to_bottom,black_88%,transparent)]' : 'max-h-[32rem]',
        )}
      >
        <DataGrid
          key={view}
          tone="stage"
          title={`${rows.length} ${view}`}
          rows={rows}
          columns={COLUMNS[view]}
          rowId={(r) => r.key}
          onRowOpen={(r) => onSay(r.memberId)}
          actionLabel="Say ID"
        />
      </div>
    </section>
  );
}
