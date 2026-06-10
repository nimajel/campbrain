'use client';

import { usePathname } from 'next/navigation';
import { NAV_LINKS } from './nav-links';

export default function NavMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <div className={`nav-menu-backdrop${open ? ' show' : ''}`} onClick={onClose} aria-hidden={!open}>
      <nav className="nav-menu" aria-label="Site" onClick={(e) => e.stopPropagation()}>
        <a href="/" className="topnav-brand" style={{ fontSize: 18, padding: '4px 0 12px' }} onClick={onClose}>Camp<span>Brain</span></a>
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <a key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClose}>
              {label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
