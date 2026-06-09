import type { Metadata } from 'next';
import './globals.css';
import { Inter, Fraunces } from 'next/font/google';
import NavBar from './components/NavBar';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  title: 'CampBrain',
  description: 'Personal camping reservation assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <div className="layout">
          <NavBar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
