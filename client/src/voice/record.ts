/**
 * An order as the kit's RecordView. The section ids are what the agent points at (FOCUS_FOR in
 * agentTurns.ts): summary (the HighlightBand), medications, pickup, refills, pharmacy.
 */
import { createElement } from 'react';
import { BoxIcon, DEFAULT_TONE_RULES, UserIcon, toneFor, type RecordField, type RecordView, type Step, type Tone } from '@deepgram-devs/dg-brand-ui';

import { statusLabel, type Order } from './order';

const TONE_RULES: Array<[RegExp, Tone]> = [[/ready|shipped/i, 'good'], ...DEFAULT_TONE_RULES];

/** An order status's pill tone: ready and shipped are good news here, then the kit's rules */
export const orderTone = (label: string): Tone => toneFor(label, TONE_RULES);

/** "2025-03-25T10:00" → "Mar 25 · 10:00 AM". The server keeps demo dates in local time, with no zone. */
export function formatWhen(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

function dayOf(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "8AM–8PM" → "8 AM–8 PM" */
const hours = (value?: string) => value?.replace(/(\d)(AM|PM)/g, '$1 $2');

function stepsFor(order: Order, delivery: boolean): Step[] {
  const t = order.timing ?? {};
  const titles = delivery ? ['Received', 'Filling', 'Shipped', 'Delivered'] : ['Received', 'Filling', 'Ready for pickup', 'Picked up'];
  const reached: Record<string, number> = { processing: 1, ready_for_pickup: 2, shipped: 2, delivered: 3 };
  const current = reached[order.status] ?? 0;
  const details = delivery
    ? [undefined, undefined, formatWhen(t.shipped_at), formatWhen(t.delivered_at) ?? (t.expected_delivery_time ? `Expected ${formatWhen(t.expected_delivery_time)}` : undefined)]
    : [undefined, undefined, formatWhen(t.ready_at) ?? (t.expected_pickup_time ? `Expected ${formatWhen(t.expected_pickup_time)}` : undefined), undefined];
  return titles.map((title, i) => ({
    title,
    detail: details[i],
    // Delivered is the end of the road: every step is done
    state: i < current || (order.status === 'delivered' && i === current) ? 'done' : i === current ? 'active' : 'pending',
  }));
}

export function toRecordView(order: Order): RecordView {
  const t = order.timing ?? {};
  const delivery = order.status === 'shipped' || order.status === 'delivered' || !!t.expected_delivery_time;
  const label = statusLabel(order.status);
  const rx = order.prescriptions;
  const refills = rx.reduce((sum, p) => sum + p.refills_remaining, 0);
  const quantity = rx.reduce((sum, p) => sum + p.quantity, 0);

  const pickupFields: RecordField[] = (
    [
      ['Expected pickup', formatWhen(t.expected_pickup_time)],
      ['Ready since', formatWhen(t.ready_at)],
      ['Shipped', formatWhen(t.shipped_at)],
      ['Expected delivery', formatWhen(t.expected_delivery_time)],
      ['Delivered', formatWhen(t.delivered_at)],
    ] as const
  ).flatMap(([label, value]) => (value ? [{ label, value }] : []));

  const when = delivery
    ? (dayOf(t.delivered_at) ?? dayOf(t.expected_delivery_time) ?? '—')
    : (dayOf(t.ready_at) ?? dayOf(t.expected_pickup_time) ?? '—');

  return {
    id: order.order_id,
    noun: 'Order',
    breadcrumb: 'Pharmacy / Orders /',
    title: 'Review this order.',
    status: { label, tone: orderTone(label) },
    readOnly: true,
    steps: stepsFor(order, delivery),
    tiles: [
      { label: 'Member', title: order.member_id, lines: [`Store ${order.pharmacy?.store_id ?? '—'}`], icon: createElement(UserIcon) },
      {
        label: rx.length === 1 ? 'Prescription' : 'Prescriptions',
        title: rx.map((p) => p.name).join(', ') || '—',
        lines: rx.map((p) => p.rx_id),
        icon: createElement(BoxIcon),
      },
    ],
    stats: [
      { label: 'Status', value: label },
      { label: 'Quantity', value: String(quantity) },
      { label: 'Refills left', value: String(refills) },
      { label: delivery ? 'Delivery' : 'Pickup', value: when },
    ],
    sections: [
      {
        type: 'fields',
        id: 'medications',
        title: 'Medications',
        fields: rx.flatMap((p) => [
          { label: 'Medication', value: p.name },
          { label: 'Prescription', value: p.rx_id, numeric: true },
          { label: 'Quantity', value: String(p.quantity), numeric: true },
        ]),
        columns: rx.length === 1 ? 1 : 2,
      },
      {
        type: 'fields',
        id: 'pickup',
        title: delivery ? 'Delivery' : 'Pickup',
        fields: pickupFields.length ? pickupFields : [{ label: 'Timing', value: 'Not scheduled yet' }],
      },
      {
        type: 'tags',
        id: 'refills',
        title: 'Refills',
        summary: refills === 0 ? 'No refills left' : `${refills} ${refills === 1 ? 'refill' : 'refills'} left`,
        level: refills === 0 ? 'bad' : refills === 1 ? 'warn' : 'ok',
        tags: rx.map((p) => ({ label: `${p.rx_id} · ${p.refills_remaining}`, tone: p.refills_remaining === 0 ? ('danger' as const) : ('neutral' as const) })),
      },
      {
        type: 'fields',
        id: 'pharmacy',
        title: 'Pharmacy',
        fields: [
          { label: 'Store', value: order.pharmacy?.store_id ?? '—', numeric: true },
          { label: 'Weekdays', value: hours(order.pharmacy?.hours?.weekday_hours) ?? '—' },
          { label: 'Weekends', value: hours(order.pharmacy?.hours?.weekend_hours) ?? '—' },
        ],
      },
    ],
  };
}
