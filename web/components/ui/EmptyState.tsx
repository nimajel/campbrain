import type { CSSProperties, ReactNode } from 'react';

export default function EmptyState({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="empty" style={style}>{children}</div>;
}
