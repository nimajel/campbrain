import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CampBrain',
  description: 'Personal camping reservation assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar-brand">
              Camp<span>Brain</span>
            </div>
            <nav>
              <a href="/">Dashboard</a>
              <a href="/available">What&apos;s Available</a>
              <a href="/explore">Take Me Camping!</a>
              <a href="/alerts">Alerts</a>
              <a href="/scan-history">Scan History</a>
              <a href="/calendar">Calendar</a>
              <a href="/settings">Settings</a>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
