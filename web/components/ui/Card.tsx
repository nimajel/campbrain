import type { CSSProperties, ReactNode } from 'react';

export default function Card({
  children,
  actions,
  style,
}: {
  children: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {children}
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}
