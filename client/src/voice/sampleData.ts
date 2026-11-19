/**
 * The sample data in the old Data Browser's three views: orders, prescriptions, and members.
 * The call screen shows them as cards, the settings drawer as a grid. Every row belongs to one
 * member, whose ID is what a caller says.
 */
import { statusLabel, type Order } from './order';

export type SampleView = 'orders' | 'prescriptions' | 'members';

export const SAMPLE_VIEWS: { value: SampleView; label: string }[] = [
  { value: 'orders', label: 'Orders' },
  { value: 'prescriptions', label: 'Prescriptions' },
  { value: 'members', label: 'Members' },
];

export type SampleRow = {
  /** Unique in its view: the order, prescription, or member ID */
  key: string;
  memberId: string;
  orderIds: string[];
  rxIds: string[];
  medication: string;
  quantity: number;
  refills: number;
  /** "Processing", "Ready for pickup"…; empty when a member's orders differ */
  status: string;
};

const ORDER_COUNT = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'}`;
export const orderCount = ORDER_COUNT;

function orderRow(order: Order, key = order.order_id): SampleRow {
  return {
    key,
    memberId: order.member_id,
    orderIds: [order.order_id],
    rxIds: order.prescriptions.map((p) => p.rx_id),
    medication: order.prescriptions.map((p) => p.name).join(', '),
    quantity: order.prescriptions.reduce((n, p) => n + p.quantity, 0),
    refills: order.prescriptions.reduce((n, p) => n + p.refills_remaining, 0),
    status: statusLabel(order.status),
  };
}

/** The rows of one view, with the suggested member's rows first */
export function sampleRows(view: SampleView, orders: Order[], suggestedMemberId?: string): SampleRow[] {
  let rows: SampleRow[];
  if (view === 'orders') {
    rows = orders.map((o) => orderRow(o));
  } else if (view === 'prescriptions') {
    rows = orders.flatMap((o) =>
      o.prescriptions.map((p) => ({
        ...orderRow(o, p.rx_id),
        rxIds: [p.rx_id],
        medication: p.name,
        quantity: p.quantity,
        refills: p.refills_remaining,
      })),
    );
  } else {
    const byMember = new Map<string, Order[]>();
    for (const o of orders) byMember.set(o.member_id, [...(byMember.get(o.member_id) ?? []), o]);
    rows = [...byMember].map(([memberId, list]) => {
      const statuses = [...new Set(list.map((o) => statusLabel(o.status)))];
      return {
        key: memberId,
        memberId,
        orderIds: list.map((o) => o.order_id),
        rxIds: list.flatMap((o) => o.prescriptions.map((p) => p.rx_id)),
        medication: list.flatMap((o) => o.prescriptions.map((p) => p.name)).join(', '),
        quantity: list.reduce((n, o) => n + o.prescriptions.reduce((m, p) => m + p.quantity, 0), 0),
        refills: list.reduce((n, o) => n + o.prescriptions.reduce((m, p) => m + p.refills_remaining, 0), 0),
        status: statuses.length === 1 ? statuses[0] : '',
      };
    });
  }
  if (!suggestedMemberId) return rows;
  return [...rows.filter((r) => r.memberId === suggestedMemberId), ...rows.filter((r) => r.memberId !== suggestedMemberId)];
}

/** What a card in each view shows: its own ID small, the thing itself large, related IDs under it */
export function cardFor(view: SampleView, row: SampleRow): { recordId: string; title: string; subtitle: string } {
  if (view === 'orders') {
    return { recordId: row.orderIds[0], title: row.medication, subtitle: `Member ${row.memberId} · ${row.rxIds.join(', ')}` };
  }
  if (view === 'prescriptions') {
    const refills = `${row.refills} ${row.refills === 1 ? 'refill' : 'refills'}`;
    return { recordId: row.rxIds[0], title: row.medication, subtitle: `Qty ${row.quantity} · ${refills} · ${row.orderIds[0]}` };
  }
  return { recordId: ORDER_COUNT(row.orderIds.length), title: row.memberId, subtitle: `${row.orderIds.join(', ')} · ${row.rxIds.join(', ')}` };
}
