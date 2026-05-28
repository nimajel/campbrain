import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CampBrain',
  description: 'Personal camping reservation assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
              <a href="/targets">Targets</a>
              <a href="/windows">Booking Windows</a>
              <a href="/scan">Scan</a>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
