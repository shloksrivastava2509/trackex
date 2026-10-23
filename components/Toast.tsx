'use client';
import { useEffect } from 'react';

export default function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg px-4 py-2 text-[13px] shadow-lg"
      style={{ background: 'var(--text)', color: 'var(--panel)' }}
    >
      {message}
    </div>
  );
}
