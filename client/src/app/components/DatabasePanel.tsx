'use client';

import { useState, useEffect } from 'react';

interface Prescription {
  rx_id: string;
  name: string;
  quantity: number;
  refills_remaining: number;
}

interface OrderData {
  order_id: string;
  member_id: string;
  status: string;
  prescriptions: Prescription[];
}

const statusConfig: Record<string, { bgColor: string; textColor: string; label: string }> = {
  processing: { bgColor: '#F0C200', textColor: '#1C1C1E', label: 'Processing' },
  ready_for_pickup: { bgColor: '#3BAAFF', textColor: '#ffffff', label: 'Ready for Pickup' },
  shipped: { bgColor: '#B38FFF', textColor: '#ffffff', label: 'Shipped' },
  delivered: { bgColor: '#3CCB77', textColor: '#ffffff', label: 'Delivered' },
};

export const DatabasePanel = () => {
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeView, setActiveView] = useState<'orders' | 'prescriptions' | 'members'>('orders');
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [highlightedMemberId, setHighlightedMemberId] = useState<string | null>(null);
  const [highlightedRxId, setHighlightedRxId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const response = await fetch('/api/pharmacy-data');
        const data = await response.json();
        
        if (isMounted) {
          setOrders(data);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load pharmacy data:', err);
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.order_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.member_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.prescriptions.some((p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.rx_id.toLowerCase().includes(searchTerm.toLowerCase())
      );
    return matchesSearch;
  });

  const totalRx = orders.reduce((sum, o) => sum + o.prescriptions.length, 0);

  // Flatten prescriptions
  const prescriptionsData = orders.flatMap((order) =>
    order.prescriptions.map((rx) => ({
      ...rx,
      order_id: order.order_id,
      member_id: order.member_id,
    }))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: '#0a0a0a' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#06b6d4' }} />
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ 
      background: '#000000'
    }}>
      {/* Left Sidebar - Minimal Deepgram Style */}
      <div className="w-64 flex flex-col border-r" style={{ 
        background: '#0a0a0a',
        borderColor: 'rgba(113, 113, 122, 0.2)'
      }}>
        {/* Header - Data Browser floating card */}
        <div className="p-3">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ 
            background: '#1a1a1f',
            border: '1px solid rgba(113, 113, 122, 0.15)'
          }}>
            <svg 
              style={{ width: '16px', height: '16px', color: '#A892FF' }} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
            </svg>
            <span className="text-sm font-medium" style={{ color: '#ffffff' }}>
              Data Browser
            </span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-2">
            
            <div className="space-y-1">
              {/* Orders */}
              <div
                onClick={() => setActiveView('orders')}
                className="cursor-pointer transition-all duration-150 rounded-md"
                style={{
                  padding: '10px 12px',
                  background: activeView === 'orders' ? 'rgba(168, 146, 255, 0.08)' : 'transparent',
                  borderLeft: activeView === 'orders' ? '2px solid #A892FF' : '2px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (activeView !== 'orders') {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeView !== 'orders') {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <svg 
                    style={{ 
                      width: '16px', 
                      height: '16px',
                      color: activeView === 'orders' ? '#A892FF' : '#52525b',
                      flexShrink: 0
                    }} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                  <span className="text-sm flex-1" style={{ 
                    color: activeView === 'orders' ? '#ffffff' : '#9ca3af',
                    fontWeight: activeView === 'orders' ? 500 : 400
                  }}>
                    orders
                  </span>
                  <span className="text-xs tabular-nums px-1.5 py-0.5 rounded" style={{ 
                    color: '#71717a',
                    fontSize: '11px',
                    background: 'rgba(113, 113, 122, 0.1)'
                  }}>
                    {orders.length}
                  </span>
                </div>
              </div>

              {/* Prescriptions */}
              <div
                onClick={() => setActiveView('prescriptions')}
                className="cursor-pointer transition-all duration-150 rounded-md"
                style={{
                  padding: '10px 12px',
                  background: activeView === 'prescriptions' ? 'rgba(168, 146, 255, 0.08)' : 'transparent',
                  borderLeft: activeView === 'prescriptions' ? '2px solid #A892FF' : '2px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (activeView !== 'prescriptions') {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeView !== 'prescriptions') {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <svg 
                    style={{ 
                      width: '16px', 
                      height: '16px',
                      color: activeView === 'prescriptions' ? '#A892FF' : '#52525b',
                      flexShrink: 0
                    }} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
                  </svg>
                  <span className="text-sm flex-1" style={{ 
                    color: activeView === 'prescriptions' ? '#ffffff' : '#9ca3af',
                    fontWeight: activeView === 'prescriptions' ? 500 : 400
                  }}>
                    prescriptions
                  </span>
                  <span className="text-xs tabular-nums px-1.5 py-0.5 rounded" style={{ 
                    color: '#71717a',
                    fontSize: '11px',
                    background: 'rgba(113, 113, 122, 0.1)'
                  }}>
                    {totalRx}
                  </span>
                </div>
              </div>

              {/* Members */}
              <div
                onClick={() => setActiveView('members')}
                className="cursor-pointer transition-all duration-150 rounded-md"
                style={{
                  padding: '10px 12px',
                  background: activeView === 'members' ? 'rgba(168, 146, 255, 0.08)' : 'transparent',
                  borderLeft: activeView === 'members' ? '2px solid #A892FF' : '2px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (activeView !== 'members') {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeView !== 'members') {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <svg 
                    style={{ 
                      width: '16px', 
                      height: '16px',
                      color: activeView === 'members' ? '#A892FF' : '#52525b',
                      flexShrink: 0
                    }} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                  </svg>
                  <span className="text-sm flex-1" style={{ 
                    color: activeView === 'members' ? '#ffffff' : '#9ca3af',
                    fontWeight: activeView === 'members' ? 500 : 400
                  }}>
                    members
                  </span>
                  <span className="text-xs tabular-nums px-1.5 py-0.5 rounded" style={{ 
                    color: '#71717a',
                    fontSize: '11px',
                    background: 'rgba(113, 113, 122, 0.1)'
                  }}>
                    {[...new Set(orders.map(o => o.member_id))].length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Refined Status */}
        <div className="px-4 py-3 text-xs" style={{ 
          borderTop: '1px solid rgba(113, 113, 122, 0.15)'
        }}>
          <div className="flex items-center justify-between" style={{ color: '#a0a0a0' }}>
            <div className="flex items-center gap-1.5">
              <svg className="w-3 h-3" style={{ color: '#a0a0a0', opacity: 0.6 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <span style={{ fontSize: '11px' }}>Last sync: Just now</span>
            </div>
            <button 
              onClick={() => window.location.reload()} 
              className="p-1 rounded transition-all duration-200"
              style={{ color: '#a0a0a0', transform: 'scale(1)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#A892FF';
                e.currentTarget.style.transform = 'scale(1.15)';
                e.currentTarget.style.filter = 'drop-shadow(0 0 4px rgba(168, 146, 255, 0.5))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#a0a0a0';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.filter = 'none';
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Minimal Deepgram Style */}
      <div className="flex-1 flex flex-col" style={{ 
        background: '#0f0f12',
        minWidth: 0,
        overflow: 'hidden'
      }}>
        {/* Toolbar - Minimal */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold capitalize text-white">
              {activeView}
            </h2>
            <span className="text-xs" style={{ color: '#71717a' }}>
              {activeView === 'orders' && filteredOrders.length}
              {activeView === 'prescriptions' && totalRx}
              {activeView === 'members' && [...new Set(filteredOrders.map(o => o.member_id))].length}
              {' '}records
            </span>
          </div>

          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#52525b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 pl-10 text-sm text-white rounded-lg w-48 focus:outline-none transition-all"
              style={{ 
                background: '#1a1a1f', 
                border: '1px solid rgba(113, 113, 122, 0.15)',
                caretColor: '#A892FF'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(168, 146, 255, 0.4)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(113, 113, 122, 0.15)';
              }}
            />
          </div>
        </div>

        {/* Data Table with Scroll - Minimal */}
        <div className="flex-1 px-4 pb-4 overflow-hidden">
          <div className="rounded-lg h-full" style={{ 
            background: '#0a0a0a',
            border: '1px solid rgba(113, 113, 122, 0.1)',
            overflow: 'auto'
          }}>
            {activeView === 'orders' && (
              <div style={{ 
                overflowX: 'scroll', 
                overflowY: 'auto', 
                width: '100%', 
                height: '100%',
                WebkitOverflowScrolling: 'touch'
              }}>
                <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#000000', borderBottom: '1px solid rgba(113, 113, 122, 0.2)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Order ID</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Member ID</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '140px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Prescription IDs</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '180px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const status = statusConfig[order.status] || statusConfig.processing;
                      const isHighlighted = highlightedOrderId === order.order_id;
                      return (
                        <tr 
                          key={order.order_id} 
                          id={`order-${order.order_id}`}
                          className="cursor-pointer transition-all duration-200" 
                          style={{ 
                            borderBottom: '1px solid rgba(113, 113, 122, 0.08)',
                            background: isHighlighted 
                              ? 'rgba(168, 146, 255, 0.15)' 
                              : (orders.indexOf(order) % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)'),
                            transform: 'translateX(0)',
                            boxShadow: isHighlighted ? '0 0 0 2px rgba(168, 146, 255, 0.3)' : 'none'
                          }}
                          onClick={() => setHighlightedOrderId(null)}
                          onMouseEnter={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = orders.indexOf(order) % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)';
                            }
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                        >
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveView('prescriptions');
                                // Highlight the first prescription of this order
                                if (order.prescriptions.length > 0) {
                                  setHighlightedRxId(order.prescriptions[0].rx_id);
                                  setTimeout(() => {
                                    const element = document.getElementById(`rx-${order.prescriptions[0].rx_id}`);
                                    if (element) {
                                      const scrollContainer = element.closest('div[style*="overflow"]');
                                      if (scrollContainer) {
                                        const elementRect = element.getBoundingClientRect();
                                        const containerRect = scrollContainer.getBoundingClientRect();
                                        const scrollTop = scrollContainer.scrollTop;
                                        const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                        scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                      }
                                    }
                                  }, 100);
                                }
                              }}
                              className="font-mono text-sm transition-all duration-200"
                              style={{ 
                                color: '#A892FF',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.textDecoration = 'underline';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.textDecoration = 'none';
                              }}
                            >
                              {order.order_id}
                            </button>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveView('members');
                                setHighlightedMemberId(order.member_id);
                                setTimeout(() => {
                                  const element = document.getElementById(`member-${order.member_id}`);
                                  if (element) {
                                    const scrollContainer = element.closest('div[style*="overflow"]');
                                    if (scrollContainer) {
                                      const elementRect = element.getBoundingClientRect();
                                      const containerRect = scrollContainer.getBoundingClientRect();
                                      const scrollTop = scrollContainer.scrollTop;
                                      const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                      scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                    }
                                  }
                                }, 100);
                              }}
                              className="font-mono text-sm transition-all duration-200"
                              style={{ 
                                color: '#A892FF',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.textDecoration = 'underline';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.textDecoration = 'none';
                              }}
                            >
                              {order.member_id}
                            </button>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '140px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <div className="flex flex-wrap gap-x-2">
                              {order.prescriptions.map((p, rxIdx) => (
                                <span key={rxIdx}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveView('prescriptions');
                                      setHighlightedRxId(p.rx_id);
                                      setTimeout(() => {
                                        const element = document.getElementById(`rx-${p.rx_id}`);
                                        if (element) {
                                          const scrollContainer = element.closest('div[style*="overflow"]');
                                          if (scrollContainer) {
                                            const elementRect = element.getBoundingClientRect();
                                            const containerRect = scrollContainer.getBoundingClientRect();
                                            const scrollTop = scrollContainer.scrollTop;
                                            const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                            scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                          }
                                        }
                                      }, 100);
                                    }}
                                    className="font-mono text-sm transition-all duration-200"
                                    style={{ 
                                      color: '#A892FF',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 0
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.textDecoration = 'underline';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.textDecoration = 'none';
                                    }}
                                  >
                                    {p.rx_id}
                                  </button>
                                  {rxIdx < order.prescriptions.length - 1 && <span className="text-sm" style={{ color: '#a1a1aa' }}>, </span>}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap" style={{ minWidth: '180px' }}>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold" style={{ 
                              background: status.bgColor,
                              color: status.textColor,
                              animation: 'bounceIn 0.5s ease-out'
                            }}>
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeView === 'prescriptions' && (
              <div style={{ 
                overflowX: 'scroll', 
                overflowY: 'auto', 
                width: '100%', 
                height: '100%',
                WebkitOverflowScrolling: 'touch'
              }}>
                <table style={{ 
                  width: 'max-content', 
                  minWidth: '100%', 
                  borderCollapse: 'collapse'
                }}>
                  <thead style={{ background: '#000000', borderBottom: '1px solid rgba(113, 113, 122, 0.2)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>RX ID</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '200px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Medication</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Order ID</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '80px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Refills</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '80px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Qty</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', minWidth: '150px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prescriptionsData.map((rx, idx) => {
                      const order = orders.find(o => o.order_id === rx.order_id);
                      const status = order ? (statusConfig[order.status] || statusConfig.processing) : statusConfig.processing;
                      const isHighlighted = highlightedRxId === rx.rx_id;
                      return (
                        <tr 
                          key={idx} 
                          id={`rx-${rx.rx_id}`}
                          className="transition-all duration-200" 
                          style={{ 
                            borderBottom: '1px solid rgba(113, 113, 122, 0.08)',
                            background: isHighlighted 
                              ? 'rgba(168, 146, 255, 0.15)' 
                              : (idx % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)'),
                            transform: 'translateX(0)',
                            boxShadow: isHighlighted ? '0 0 0 2px rgba(168, 146, 255, 0.3)' : 'none'
                          }}
                          onClick={() => setHighlightedRxId(null)}
                          onMouseEnter={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)';
                            }
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                        >
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <span className="font-mono text-sm" style={{ color: '#A892FF' }}>{rx.rx_id}</span>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '200px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <span className="text-sm" style={{ color: '#a1a1aa' }}>{rx.name}</span>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '120px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveView('orders');
                                setHighlightedOrderId(rx.order_id);
                                setTimeout(() => {
                                  const element = document.getElementById(`order-${rx.order_id}`);
                                  if (element) {
                                    const scrollContainer = element.closest('div[style*="overflow"]');
                                    if (scrollContainer) {
                                      const elementRect = element.getBoundingClientRect();
                                      const containerRect = scrollContainer.getBoundingClientRect();
                                      const scrollTop = scrollContainer.scrollTop;
                                      const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                      scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                    }
                                  }
                                }, 100);
                              }}
                              className="font-mono text-sm transition-all duration-200"
                              style={{ 
                                color: '#A892FF',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.textDecoration = 'underline';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.textDecoration = 'none';
                              }}
                            >
                              {rx.order_id}
                            </button>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '80px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <span className="text-sm font-medium" style={{ color: rx.refills_remaining > 0 ? '#10b981' : '#ef4444' }}>
                              {rx.refills_remaining}
                            </span>
                          </td>
                          <td className="px-7 py-4 whitespace-nowrap" style={{ minWidth: '80px', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <span className="text-sm" style={{ color: '#a1a1aa' }}>{rx.quantity}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap" style={{ minWidth: '150px' }}>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold" style={{ 
                              background: status.bgColor,
                              color: status.textColor,
                              animation: 'bounceIn 0.5s ease-out'
                            }}>
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Members View */}
            {activeView === 'members' && (
              <div style={{ 
                overflowX: 'scroll', 
                overflowY: 'auto', 
                width: '100%', 
                height: '100%',
                WebkitOverflowScrolling: 'touch'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead style={{ background: '#000000', borderBottom: '1px solid rgba(113, 113, 122, 0.2)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', width: '33.33%', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Member ID</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', width: '33.33%', borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>Orders</th>
                      <th className="px-7 py-4 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#71717a', width: '33.33%' }}>RX IDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(filteredOrders.map(o => o.member_id))].map((memberId, idx) => {
                      const memberOrders = filteredOrders.filter(o => o.member_id === memberId);
                      const isHighlighted = highlightedMemberId === memberId;
                      return (
                        <tr 
                          key={idx} 
                          id={`member-${memberId}`}
                          className="transition-all duration-200" 
                          style={{ 
                            borderBottom: '1px solid rgba(113, 113, 122, 0.08)',
                            background: isHighlighted 
                              ? 'rgba(168, 146, 255, 0.15)' 
                              : (idx % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)'),
                            transform: 'translateX(0)',
                            boxShadow: isHighlighted ? '0 0 0 2px rgba(168, 146, 255, 0.3)' : 'none'
                          }}
                          onClick={() => setHighlightedMemberId(null)}
                          onMouseEnter={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(113, 113, 122, 0.02)';
                            }
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                        >
                          <td className="px-7 py-4 whitespace-nowrap" style={{ borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <span className="text-sm font-mono" style={{ color: '#A892FF' }}>
                              {memberId}
                            </span>
                          </td>
                          <td className="px-7 py-4" style={{ borderRight: '1px solid rgba(113, 113, 122, 0.06)' }}>
                            <div className="flex flex-wrap gap-2">
                              {memberOrders.map((order, orderIdx) => (
                                <button
                                  key={orderIdx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveView('orders');
                                    setHighlightedOrderId(order.order_id);
                                    setTimeout(() => {
                                      const element = document.getElementById(`order-${order.order_id}`);
                                      if (element) {
                                        const scrollContainer = element.closest('div[style*="overflow"]');
                                        if (scrollContainer) {
                                          const elementRect = element.getBoundingClientRect();
                                          const containerRect = scrollContainer.getBoundingClientRect();
                                          const scrollTop = scrollContainer.scrollTop;
                                          const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                          scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                        }
                                      }
                                    }, 100);
                                  }}
                                  className="transition-all duration-200 cursor-pointer"
                                  style={{
                                    padding: '0',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    color: '#A892FF',
                                    background: 'none',
                                    border: 'none',
                                    textDecoration: 'none',
                                    marginRight: '8px'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.textDecoration = 'underline';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.textDecoration = 'none';
                                  }}
                                >
                                  {order.order_id}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-7 py-4">
                            <div className="flex flex-wrap gap-2">
                              {memberOrders.flatMap(order => 
                                order.prescriptions.map((rx, rxIdx) => (
                                  <button
                                    key={`${order.order_id}-${rxIdx}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveView('prescriptions');
                                      setHighlightedRxId(rx.rx_id);
                                      setTimeout(() => {
                                        const element = document.getElementById(`rx-${rx.rx_id}`);
                                        if (element) {
                                          const scrollContainer = element.closest('div[style*="overflow"]');
                                          if (scrollContainer) {
                                            const elementRect = element.getBoundingClientRect();
                                            const containerRect = scrollContainer.getBoundingClientRect();
                                            const scrollTop = scrollContainer.scrollTop;
                                            const targetScroll = scrollTop + elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
                                            scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                          }
                                        }
                                      }, 100);
                                    }}
                                    className="transition-all duration-200 cursor-pointer"
                                    style={{
                                      padding: '0',
                                      fontSize: '12px',
                                      fontFamily: 'monospace',
                                      color: '#A892FF',
                                      background: 'none',
                                      border: 'none',
                                      textDecoration: 'none',
                                      marginRight: '8px'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.textDecoration = 'underline';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.textDecoration = 'none';
                                    }}
                                  >
                                    {rx.rx_id}
                                  </button>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Status Bar - Minimal */}
        <div className="h-9 flex items-center justify-between px-6 text-xs" style={{ 
          background: '#18181b',
          borderTop: '1px solid rgba(113, 113, 122, 0.2)',
          color: '#71717a'
        }}>
          <span>Viewing {filteredOrders.length} records</span>
          <span>Pharmacy Database v1.0</span>
        </div>
      </div>
    </div>
  );
};

