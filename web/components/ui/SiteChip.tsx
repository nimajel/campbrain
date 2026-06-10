import type { CSSProperties, ReactNode } from 'react';

export default function SiteChip({
  children,
  more = false,
  onClick,
  title,
  style,
}: {
  children: ReactNode;
  more?: boolean;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}) {
  const className = more ? 'site-chip site-chip--more' : 'site-chip';
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title} style={style}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title} style={style}>
      {children}
    </span>
  );
}
