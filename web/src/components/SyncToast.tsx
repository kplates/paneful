import React, { useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { useUIStore } from '../stores/uiStore';

export function SyncToast() {
  const syncToast = useUIStore((s) => s.syncToast);
  const dismissSyncToast = useUIStore((s) => s.dismissSyncToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!syncToast) {
      setVisible(false);
      return;
    }

    // Trigger slide-in on next frame
    requestAnimationFrame(() => setVisible(true));

    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(dismissSyncToast, 200); // wait for fade-out transition
    }, 3000);

    return () => clearTimeout(timer);
  }, [syncToast?.id]);

  if (!syncToast) return null;

  return (
    <div
      onClick={() => {
        setVisible(false);
        setTimeout(dismissSyncToast, 200);
      }}
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 8,
        background: 'var(--surface-2)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        fontSize: 13,
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translate(-50%, 0)' : 'translate(-50%, -8px)',
        transition: 'opacity 200ms ease, transform 200ms ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <MonitorSmartphone size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span>
        Synced to <strong>{syncToast.projectName}</strong>
      </span>
    </div>
  );
}
