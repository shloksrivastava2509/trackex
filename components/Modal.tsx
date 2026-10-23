'use client';
import { useEffect, useRef } from 'react';

export default function Modal({
  title, children, onClose, labelledBy = 'modal-title'
}: { title: string; children: React.ReactNode; onClose: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="card w-full max-w-md p-5 shadow-xl">
        <h2 id={labelledBy} className="m-0 mb-2 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
