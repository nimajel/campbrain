'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { NAV_LINKS } from './nav-links';
import NavMenu from './NavMenu';

export default function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="topnav">
      <a href="/" className="topnav-brand">Camp<span>Brain</span></a>
      <nav className="navpill" aria-label="Main">
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <a key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>{label}</a>
          );
        })}
      </nav>
      <div className="topnav-avatar" aria-hidden="true" />
      <button
        type="button"
        className="topnav-burger"
        aria-label="Menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
      >
        ☰
      </button>
      <NavMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
