import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'green' | 'red' | 'blue' | 'gray' | 'match';

export default function Badge({
  tone,
  children,
  title,
  style,
}: {
  tone: BadgeTone;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title} style={style}>
      {children}
    </span>
  );
}
