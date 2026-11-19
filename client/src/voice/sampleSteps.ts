/**
 * A random sample order for each call, and what to say to retrieve it. Shown on the stage until
 * the agent finds an order, and used as the panel's prompts.
 */
import type { Order } from './order';

export type SayStep = { lead: string; phrase: string };

export function pickRandomOrder(orders: Order[]): Order | null {
  if (!orders.length) return null;
  return orders[Math.floor(Math.random() * orders.length)];
}

/** A random order other than the current one, when there's another to pick */
export function pickAnotherOrder(orders: Order[], current: Order | null): Order | null {
  const others = current ? orders.filter((o) => o.order_id !== current.order_id) : orders;
  return pickRandomOrder(others) ?? current;
}

/** The two things a caller says to retrieve an order */
export function stepsFor(order: Order): SayStep[] {
  return [
    { lead: 'Try saying', phrase: 'I’d like to check my prescription order.' },
    { lead: 'Then,', phrase: `My member ID is ${order.member_id}.` },
  ];
}

/** Every sample order, from the same data the agent's tools read */
export async function fetchOrders(signal?: AbortSignal): Promise<Order[]> {
  const res = await fetch('/api/pharmacy-data', { signal });
  if (!res.ok) throw new Error(`pharmacy-data ${res.status}`);
  return (await res.json()) as Order[];
}
