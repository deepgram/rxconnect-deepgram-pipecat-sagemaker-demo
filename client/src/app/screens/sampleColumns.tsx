/**
 * The old Data Browser's views as DataGrid columns, for paper (the settings drawer) or the dark
 * stage (the call screen). Every column it had is here; related IDs ride as a muted second line
 * under each row's main item, so three columns carry it all.
 */
import { StatusPill, type DataGridColumn } from '@deepgram-devs/dg-brand-ui';

import { orderTone } from '@/voice/record';
import type { SampleRow, SampleView } from '@/voice/sampleData';

// The kit's StatusPill, as in its DataGrid designs. It never wraps, so where a grid is narrow the
// kit's grid scrolls sideways in its own box.
const statusCell = (r: SampleRow) =>
  r.status ? <StatusPill tone={orderTone(r.status)}>{r.status}</StatusPill> : '—';

const ids = (list: string[]) => list.join(', ');

export function sampleColumns(surface: 'paper' | 'stage'): Record<SampleView, DataGridColumn<SampleRow>[]> {
  const muted = surface === 'paper' ? 'text-muted' : 'text-white/70';
  const withLine = (main: string, sub: string) => (
    <>
      {main}
      <span className={`block text-sm tabular-nums ${muted}`}>{sub}</span>
    </>
  );
  return {
    orders: [
      {
        key: 'order',
        header: 'Order ID',
        primary: true,
        cell: (r) => withLine(r.orderIds[0], ids(r.rxIds)),
        sortValue: (r) => r.orderIds[0],
      },
      { key: 'memberId', header: 'Member ID' },
      { key: 'status', header: 'Status', cell: statusCell },
    ],
    prescriptions: [
      // The short RX ID is the main column (the kit keeps it on one line). The medication column
      // wraps, so it carries the order, refills, and quantity on its second line.
      { key: 'rx', header: 'RX ID', primary: true, cell: (r) => r.rxIds[0], sortValue: (r) => r.rxIds[0] },
      {
        key: 'medication',
        header: 'Medication',
        // Non-breaking spaces keep each fact on one line when the column wraps
        cell: (r) =>
          withLine(r.medication, `${r.orderIds[0]} · ${r.refills} ${r.refills === 1 ? 'refill' : 'refills'} · Qty ${r.quantity}`),
      },
      { key: 'status', header: 'Status', cell: statusCell },
    ],
    members: [
      { key: 'memberId', header: 'Member ID', primary: true },
      { key: 'orders', header: 'Orders', cell: (r) => ids(r.orderIds), sortValue: (r) => ids(r.orderIds) },
      { key: 'rx', header: 'RX IDs', cell: (r) => ids(r.rxIds), sortValue: (r) => ids(r.rxIds) },
    ],
  };
}
