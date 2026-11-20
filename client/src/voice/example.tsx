/**
 * RxConnect as data: the brand, the caller, the copy, and fixtures for every screen.
 * RxConnect is a fictional pharmacy. The fixtures are ORD001 / M1001 from
 * data/pharmacy-order-data.json, and a conversation from a real call.
 */
import type { Turn } from '@deepgram-devs/dg-brand-ui';

import type { Order } from './order';
import { toRecordView } from './record';
import type { DemoExample } from './types';

/** RxConnect's mark: a capsule. The kit's recipe: 32×32, a 3px currentColor outline, magenta and ring-blue accents. */
export function RxConnectMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="3" y="10.5" width="26" height="11" rx="5.5" transform="rotate(-45 16 16)" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M12.5 12.5 19.5 19.5" fill="none" stroke="#e042ff" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 9.5 22.5 12" fill="none" stroke="#00b2ff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const SAMPLE_ORDER: Order = {
  order_id: 'ORD001',
  member_id: 'M1001',
  status: 'processing',
  prescriptions: [{ rx_id: 'RX1001', name: 'Amoxicillin 500mg', quantity: 21, refills_remaining: 0 }],
  timing: {
    ready_at: null,
    shipped_at: null,
    delivered_at: null,
    expected_pickup_time: '2025-03-25T10:00',
    expected_delivery_time: null,
  },
  pharmacy: { store_id: 'SPR-001', hours: { weekday_hours: '8AM–8PM', weekend_hours: '8AM–5PM' } },
};

const at = (seconds: number) => `2026-11-18T16:41:${String(seconds).padStart(2, '0')}-05:00`;
const agent = (id: string, text: string, seconds: number, chips?: Turn['chips']): Turn => ({ id, role: 'assistant', text, at: at(seconds), chips, final: true });
const caller = (id: string, text: string, seconds?: number): Turn =>
  seconds === undefined ? { id, role: 'user', text, final: false } : { id, role: 'user', text, at: at(seconds), final: true };
const tool = (id: string, name: string, args: Record<string, unknown>, seconds: number, ms?: number): Turn => ({
  id,
  role: 'tool',
  text: '',
  at: at(seconds),
  call: { name, args, status: ms === undefined ? 'running' : 'completed', ms },
});

export const GREETING = "Hi! You're speaking with our virtual pharmacy assistant. How may I assist you today?";

export const rxconnect: DemoExample = {
  id: 'rxconnect',
  domain: 'Pharmacy',
  brand: { name: 'RxConnect', tagline: 'Pharmacy · Prescriptions', deskTagline: 'Pharmacy desk', mark: <RxConnectMark /> },
  hero: {
    // Generated with ChatGPT image generation: no people or real brand names in it
    src: '/images/pharmacy-hero.jpg',
    alt: 'A bright pharmacy counter with prescription bottles in front of stocked shelves.',
    // Phones crop the photo: keep the bottles in view
    position: '82% center',
  },
  personas: [
    {
      id: 'member',
      label: 'Member',
      mode: 'lookup',
      kicker: 'Your pharmacy, by voice',
      title: 'Check your prescription by voice.',
      intro: 'Say your member ID. We’ll find your order and tell you what’s in it, when it’s ready, and how many refills you have left.',
      caption: 'Say your member ID to begin.',
      note: 'View only. You can hear your order, pickup, and refill details, but not change them.',
      prompts: ['I’d like to check my prescription order', 'My member ID is M1001'],
    },
  ],
  record: toRecordView(SAMPLE_ORDER),
  recordPrompts: ['What medication is in my order?', 'When will it be ready?', 'Do I have any refills?', 'What’s my order status?'],
  found: { kicker: 'Found 1 order', action: 'View order details' },
  conversation: {
    lookup: [
      agent('1', GREETING, 1),
      caller('2', 'Hi. I’d like to check on my prescription order.', 5),
      agent('3', 'Could you please provide your member ID?', 8),
      caller('4', 'My member ID is M 1 0 0'),
    ],
    record: [
      agent('1', GREETING, 1),
      caller('2', 'Hi. I’d like to check on my prescription order. My member ID is M1001.', 20),
      tool('3', 'verify_member_id', { member_id: 'M1001' }, 21, 3),
      tool('4', 'list_member_orders', { member_id: 'M1001' }, 22, 1),
      agent('5', 'You have 1 order: O R D 0 0 1, currently processing. What else can I help with?', 23, [{ id: 'summary', label: 'Order' }]),
      caller('6', 'What medication is in that order?', 33),
      tool('7', 'get_order_details', { order_id: 'ORD001', member_id: 'M1001' }, 34, 1),
      agent('8', 'Your order contains Amoxicillin 500mg, 21 pills.', 35, [{ id: 'medications', label: 'Medications' }]),
      caller('9', 'When will it be ready for pickup?'),
    ],
  },
  shortNames: {
    verify_member_id: 'member.verify',
    list_member_orders: 'orders.list',
    get_order_details: 'order.details',
    get_order_timing: 'order.timing',
    get_order_refills: 'order.refills',
    lookup_order_status: 'order.status',
    end_session: 'session.end',
  },
  meta: 'nova-3 · en · 412 ms',
  you: 'YOU',
  about: {
    what: 'RxConnect is a voice assistant for a pharmacy. Members say their member ID, and it tells them what’s in their order, when it’s ready, and how many refills they have left.',
    viewOnly: 'It’s view only. You can hear order details, but not change them.',
    builtWith:
      'Built with Deepgram speech-to-text (Nova-3, on Amazon SageMaker or Deepgram Cloud) and text-to-speech (Aura-2), Pipecat, and OpenAI GPT-4o mini.',
    repo: 'https://github.com/deepgram/rxconnect-deepgram-pipecat-sagemaker-demo',
  },
};

/** The panel's meta line: the speech model, the language, and the last answer's latency */
export const metaLine = (latencyMs?: number) => `nova-3 · en · ${latencyMs === undefined ? '–' : latencyMs.toLocaleString('en-US')} ms`;
