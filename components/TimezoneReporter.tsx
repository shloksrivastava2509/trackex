'use client';
import { useEffect } from 'react';

export default function TimezoneReporter() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('trackex-tz-sent')) return;
    } catch { /* storage unavailable: just send */ }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;
    fetch('/api/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeZone })
    })
      .then((r) => {
        if (r.ok) { try { sessionStorage.setItem('trackex-tz-sent', '1'); } catch { /* ignore */ } }
      })
      .catch(() => {});
  }, []);
  return null;
}
