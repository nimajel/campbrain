'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/explore', label: 'Campsites' },
  { href: '/map', label: 'Map' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/scan-history', label: 'Scan History' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/settings', label: 'Settings' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <header className="topnav">
      <a href="/" className="topnav-brand">Camp<span>Brain</span></a>
      <nav className="navpill" aria-label="Main">
        {LINKS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <a key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>{label}</a>
          );
        })}
      </nav>
      <div className="topnav-avatar" aria-hidden="true" />
    </header>
  );
}
