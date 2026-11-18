'use client';

/**
 * Settings → About this app. A toggle switches between Info (what it does, the source) and
 * Data (the sample members to try, which was the Data Browser).
 * Opening it mid-call pauses the mic; App resumes it on close.
 */
import { useEffect, useState } from 'react';
import {
  CopyField,
  CtaLink,
  DataGrid,
  Drawer,
  GitHubIcon,
  PartnerLogos,
  QrCode,
  SegmentedControl,
  Section,
  StatusPill,
  type DataGridColumn,
} from '@deepgram-devs/dg-brand-ui';

import { rxconnect } from '@/voice/example';
import { statusLabel, type Order } from '@/voice/order';
import { orderTone } from '@/voice/record';

const COLUMNS: DataGridColumn<Order>[] = [
  { key: 'member_id', header: 'Member', primary: true },
  {
    key: 'medication',
    header: 'Order',
    cell: (o) => (
      <>
        {o.prescriptions.map((p) => p.name).join(', ')}
        <span className="block text-sm text-muted tabular-nums">{o.order_id}</span>
      </>
    ),
    sortValue: (o) => o.prescriptions[0]?.name ?? '',
  },
  {
    key: 'status',
    header: 'Status',
    cell: (o) => {
      const label = statusLabel(o.status);
      return <StatusPill tone={orderTone(label)}>{label}</StatusPill>;
    },
    sortValue: (o) => statusLabel(o.status),
  },
];

export type AboutTab = 'info' | 'data';

const TABS = [
  { value: 'info' as const, label: 'Info' },
  { value: 'data' as const, label: 'Data' },
];

export function AboutDrawer({ onClose, initialTab = 'info' }: { onClose: () => void; initialTab?: AboutTab }) {
  const [tab, setTab] = useState<AboutTab>(initialTab);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/pharmacy-data')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Order[]) => live && setOrders(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const { repo } = rxconnect.about;
  return (
    <Drawer kicker="Settings" title="About this app" onClose={onClose} footer={<PartnerLogos />}>
      <SegmentedControl label="Show" tone="paper" kind="tab" options={TABS} value={tab} onChange={setTab} />
      {tab === 'info' ? (
        <>
          <Section title="What it does">
            <p className="text-[1.1rem] leading-relaxed">{rxconnect.about.what}</p>
            <p className="mt-4 text-[1.1rem] leading-relaxed">{rxconnect.about.viewOnly}</p>
            <p className="mt-4 leading-relaxed text-muted">{rxconnect.about.builtWith}</p>
          </Section>
          <Section title="Source code">
            <CopyField value={repo} label={repo.replace('https://', '')} icon={<GitHubIcon className="size-5 shrink-0" />} />
            <CtaLink className="mt-4" href={repo} target="_blank">
              Open on GitHub
            </CtaLink>
            <div className="mt-6 flex items-center gap-6 rounded-panel border border-line bg-card p-5">
              <QrCode value={repo} className="size-36 shrink-0 rounded-xl border border-line" />
              <div>
                <p className="label text-fg/80">Scan to open</p>
                <p className="mt-2 leading-relaxed">Point your phone’s camera here to open the code on GitHub.</p>
              </div>
            </div>
          </Section>
        </>
      ) : (
        <Section title="Sample members">
          <p className="leading-relaxed text-muted">Say any of these member IDs on a call. Each member has one order.</p>
          <DataGrid
            className="mt-4"
            tone="paper"
            title={orders ? `${orders.length} orders` : undefined}
            rows={orders ?? []}
            columns={COLUMNS}
            rowId={(o) => o.order_id}
            empty={failed ? 'We couldn’t load the sample data. Is the server running?' : orders ? undefined : 'Loading…'}
          />
        </Section>
      )}
    </Drawer>
  );
}
