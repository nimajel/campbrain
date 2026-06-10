import type { CSSProperties, ReactNode } from 'react';

export default function Card({
  children,
  actions,
  style,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={['card', className].filter(Boolean).join(' ')} style={style}>
      {children}
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}
