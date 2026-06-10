import type { ReactNode } from 'react';

export type ChipTone = 'green' | 'red' | 'gray' | 'yellow';

export default function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
