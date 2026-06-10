import type { CSSProperties, ReactNode } from 'react';

type SiteChipProps =
  | { children: ReactNode; more?: false; onClick?: never; title?: string; style?: CSSProperties }
  | { children: ReactNode; more: true; onClick: () => void; title?: string; style?: CSSProperties };

export default function SiteChip({ children, more = false, onClick, title, style }: SiteChipProps) {
  if (more && onClick) {
    return (
      <button type="button" className="site-chip site-chip--more" onClick={onClick} title={title} style={style}>
        {children}
      </button>
    );
  }
  return (
    <span className="site-chip" title={title} style={style}>
      {children}
    </span>
  );
}
