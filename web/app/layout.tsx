import type { Metadata } from 'next';
import './globals.css';
import { Inter, Fraunces } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  title: 'CampBrain',
  description: 'Personal camping reservation assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar-brand">
              Camp<span>Brain</span>
            </div>
            <nav>
              <a href="/">Dashboard</a>
              <a href="/explore">Find Campsites</a>
              <a href="/map">Map</a>
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
