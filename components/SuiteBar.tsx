import Link from 'next/link';

/** The Trackex mark (envelope + check) drawn inline so it stays crisp on the navy bar. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" aria-hidden="true">
      <rect x="8" y="8" width="96" height="96" rx="22" fill="#2563eb" />
      <rect x="26" y="34" width="60" height="42" rx="7" fill="none" stroke="#fff" strokeWidth="6" />
      <path d="M28 38 L56 58 L84 38" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="78" r="15" fill="#22c55e" stroke="#2563eb" strokeWidth="4" />
      <path d="M77 78 L82.5 83.5 L91.5 73" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Top band shared by every page: brand on the left, page-specific controls on the right. */
export default function SuiteBar({ children, section }: { children?: React.ReactNode; section?: string }) {
  return (
    <header className="suite sticky top-0 z-40">
      <div className="flex h-12 items-center gap-3 px-4">
        <Link href="/" aria-label="Trackex home" className="flex items-center gap-2 hover:no-underline">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight">Trackex</span>
        </Link>
        {section && (
          <>
            <span aria-hidden="true" className="h-5 w-px" style={{ background: 'rgba(255,255,255,.25)' }} />
            <span className="hidden text-[13px] suite-muted sm:inline">{section}</span>
          </>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">{children}</div>
      </div>
    </header>
  );
}
