import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trackex',
  description:
    'Trackex reads your Gmail, tracks your job and internship applications, and puts interviews, assessments and hackathon deadlines on your Google Calendar.',
  icons: { icon: '/logo-light.svg' }
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
