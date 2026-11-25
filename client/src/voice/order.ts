/** An order as the server has it: data/pharmacy-order-data.json, /api/pharmacy-data, and record-loaded. */
export type Prescription = {
  rx_id: string;
  name: string;
  quantity: number;
  refills_remaining: number;
};

export type OrderStatus = 'processing' | 'ready_for_pickup' | 'shipped' | 'delivered';

export type Order = {
  order_id: string;
  member_id: string;
  status: OrderStatus | string;
  prescriptions: Prescription[];
  timing?: {
    ready_at?: string | null;
    shipped_at?: string | null;
    delivered_at?: string | null;
    expected_pickup_time?: string | null;
    expected_delivery_time?: string | null;
  };
  pharmacy?: {
    store_id?: string;
    hours?: { weekday_hours?: string; weekend_hours?: string };
  };
};

export const STATUS_LABEL: Record<string, string> = {
  processing: 'Processing',
  ready_for_pickup: 'Ready for pickup',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
